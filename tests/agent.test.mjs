import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  normalizeErrand, dueWork, addRun, taskAgentStatus, taskRunKey, buildPrompt, planSnapshot, MAX_RUNS_KEPT,
} from '../js/agent-core.js';
import { normalizeTask } from '../js/state.js';
import { config, tick } from '../scripts/agent_runner.mjs';

// Sunday 2026-10-18, 09:30 local time
const SUN_0930 = new Date(2026, 9, 18, 9, 30);

test('errands normalize to a weekly rule with sane defaults', () => {
  const e = normalizeErrand({ id: 'e1', name: ' Prebrief ', time: '25:00', worker: 'gpt', repeat: { freq: 'yearly' }, weekdays: [6, 6, 9] });
  assert.equal(e.name, 'Prebrief');
  assert.equal(e.time, '08:00');
  assert.equal(e.worker, 'claude');
  assert.equal(e.repeat.freq, 'weekly');
  assert.deepEqual(e.weekdays, [6]);
  assert.equal(e.enabled, true);
});

test('old tasks get assistant defaults on load', () => {
  const t = normalizeTask({ id: 'a', name: 'x', assignee: 'ai' });
  assert.equal(t.agentWorker, 'claude');
  assert.equal(t.agentWithPlan, false);
  assert.equal(t.agentRerunAt, null);
});

test('due work: open assistant tasks, and errands on their day once their time has passed', () => {
  const payload = {
    tasks: [
      { id: 'a', name: 'Research venues', assignee: 'ai' },
      { id: 'b', name: 'Mine', assignee: 'me' },
      { id: 'c', name: 'Done one', assignee: 'ai', done: true },
      { id: 'd', name: 'Later', assignee: 'ai', status: 'someday' },
    ],
    errands: [
      { id: 'sun', name: 'Prebrief', weekdays: [6], time: '09:00' },
      { id: 'late', name: 'Evening', weekdays: [6], time: '18:00' },
      { id: 'mon', name: 'Monday', weekdays: [0], time: '07:00' },
      { id: 'off', name: 'Paused', weekdays: [6], time: '07:00', enabled: false },
    ],
  };
  const due = dueWork(payload, { runs: [] }, SUN_0930);
  assert.deepEqual(due.map(d => d.key), ['task:a:first', 'errand:sun:2026-10-18']);
  // Once recorded, neither runs again
  const runs = due.map(d => ({ key: d.key }));
  assert.deepEqual(dueWork(payload, { runs }, SUN_0930), []);
});

test('run again and run now each make one new request', () => {
  const payload = {
    tasks: [{ id: 'a', name: 'Draft', assignee: 'ai', agentRerunAt: '2026-10-18T07:00:00.000Z' }],
    errands: [{ id: 'm', name: 'Monday', weekdays: [0], time: '07:00', runNowAt: '2026-10-18T07:10:00.000Z' }],
  };
  const results = { runs: [{ key: 'task:a:first', kind: 'task', refId: 'a', status: 'done' }] };
  assert.deepEqual(dueWork(payload, results, SUN_0930).map(d => d.key), [
    'task:a:2026-10-18T07:00:00.000Z', 'errand:m:now:2026-10-18T07:10:00.000Z',
  ]);
});

test('task status follows the current request', () => {
  const t = normalizeTask({ id: 'a', name: 'Draft', assignee: 'ai' });
  const run = { key: taskRunKey(t), kind: 'task', refId: 'a', status: 'done', finishedAt: '2026-10-18T08:00:00Z', output: 'ok' };
  assert.equal(taskAgentStatus(t, { runs: [] }).state, 'queued');
  assert.equal(taskAgentStatus(t, { runs: [run] }).state, 'ready');
  t.agentRerunAt = '2026-10-18T09:00:00.000Z';
  const s = taskAgentStatus(t, { runs: [run] });
  assert.equal(s.state, 'queued');
  assert.equal(s.run.output, 'ok', 'the last result stays visible while the re-run waits');
});

test('old runs roll off, but the latest of each task never does', () => {
  let results = { runs: [] };
  results = addRun(results, { key: 'task:old:first', kind: 'task', refId: 'old', finishedAt: '2026-01-01T00:00:00Z' });
  for (let i = 0; i < MAX_RUNS_KEPT + 10; i++) {
    results = addRun(results, { key: `errand:e:${i}`, kind: 'errand', refId: `e${i}`, finishedAt: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:${String(i % 60).padStart(2, '0')}Z` });
  }
  assert.ok(results.runs.some(r => r.refId === 'old'));
});

test('prompt carries the brief, feedback, previous result and only the open plan', () => {
  const payload = { tasks: [
    { id: 'a', name: 'Draft newsletter', assignee: 'ai', note: 'For Swing Buzz members', agentFeedback: 'Shorter' },
    { id: 'b', name: 'Old', done: true },
    { id: 'c', name: 'Maybe', status: 'someday' },
  ] };
  const plan = planSnapshot(payload, SUN_0930);
  assert.deepEqual(plan.openTasks.map(t => t.name), ['Draft newsletter']);
  assert.deepEqual(plan.someday, ['Maybe']);
  const text = buildPrompt({ kind: 'task', ref: payload.tasks[0] }, { plan, previous: { output: 'v1 text' }, now: SUN_0930 });
  for (const part of ['Today is 2026-10-18', 'Draft newsletter', 'For Swing Buzz members', 'v1 text', 'Shorter', '"openTasks"']) {
    assert.ok(text.includes(part), part);
  }
});

/* ---------- the runner end to end, against a local repo and a stand-in claude ---------- */

function setupRunner(t, fakeMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-agent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  const remote = path.join(root, 'remote.git');
  sh(root, 'init', '--bare', '-b', 'main', remote);
  const seed = path.join(root, 'seed');
  sh(root, 'clone', remote, seed);
  fs.writeFileSync(path.join(seed, 'data.json'), JSON.stringify({
    version: 12,
    tasks: [{ id: 'a', name: 'Research venues', assignee: 'ai', note: 'Three options in Utrecht' }],
    errands: [],
  }));
  sh(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
  sh(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed');
  sh(seed, 'push', 'origin', 'main');
  const home = path.join(root, 'agent');
  fs.mkdirSync(home);
  sh(home, 'clone', remote, path.join(home, 'data-repo'));
  sh(path.join(home, 'data-repo'), 'config', 'user.name', 'agent');
  sh(path.join(home, 'data-repo'), 'config', 'user.email', 'agent@t');
  const fake = path.join(root, 'fake-claude.mjs');
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const prompt = fs.readFileSync(0, 'utf8');
if (${JSON.stringify(fakeMode)} === 'limit') {
  console.log(JSON.stringify({ type: 'result', is_error: true, api_error_status: 429, result: 'Claude usage limit reached' }));
} else {
  fs.writeFileSync('venues.md', '# Venues\\n- A\\n');
  console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Found 3 venues.\\n' + (prompt.includes('Utrecht') ? 'brief seen' : ''), modelUsage: { 'claude-sonnet-5-5': {} }, num_turns: 3 }));
}
`.replace('require(', "(await import('node:module')).createRequire(import.meta.url)("));
  fs.chmodSync(fake, 0o755);
  const cfg = config({ TB_AGENT_HOME: home, TB_CLAUDE_BIN: fake });
  const remoteResults = () => {
    const check = path.join(root, 'check');
    fs.rmSync(check, { recursive: true, force: true });
    sh(root, 'clone', '-q', remote, check);
    const f = path.join(check, 'agent/results.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  };
  return { cfg, remoteResults };
}

test('runner: runs a queued task once and pushes the result', async t => {
  const { cfg, remoteResults } = setupRunner(t, 'ok');
  const first = await tick(cfg, { now: SUN_0930 });
  assert.equal(first.ran, 1);
  const res = remoteResults();
  const run = res.runs[0];
  assert.equal(run.status, 'done');
  assert.equal(run.key, 'task:a:first');
  assert.match(run.output, /brief seen/);
  assert.equal(run.model, 'claude-sonnet-5-5');
  assert.deepEqual(run.files.map(f => f.name), ['venues.md']);
  assert.ok(res.runner.lastTickAt);
  const second = await tick(cfg, { now: SUN_0930 });
  assert.equal(second.ran, 0, 'the same request never runs twice');
});

test('runner: a plan usage limit leaves the work queued and says so', async t => {
  const { cfg, remoteResults } = setupRunner(t, 'limit');
  const out = await tick(cfg, { now: SUN_0930 });
  assert.equal(out.ran, 0);
  const res = remoteResults();
  assert.deepEqual(res.runs, []);
  assert.match(res.runner.waiting.claude.message, /usage limit/);
});

test('results render a safe Markdown subset', async () => {
  const { outputHTML } = await import('../js/agent-ui.js');
  const html = outputHTML('## Plan\n**Bold** see [site](https://a.example/x) or https://b.example/y.\n<script>alert(1)</script> [x](javascript:alert(1))');
  assert.match(html, /<strong class="agent-h">Plan<\/strong>/);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/a.example\/x"[^>]*>site<\/a>/);
  assert.match(html, /<a href="https:\/\/b.example\/y"[^>]*>https:\/\/b.example\/y<\/a>\./);
  assert.ok(!html.includes('<script>'));
  assert.ok(!/href="javascript/.test(html));
  assert.equal((html.match(/<a /g) || []).length, 2);
});
