#!/usr/bin/env node
/**
 * Desktop runner for assistant work. A systemd user timer runs it every few minutes
 * (scripts/agent-runner/install.sh). Each tick:
 *   1. pull the private data repo (a local clone; uses the desktop's `gh` login)
 *   2. find due work: open tasks assigned to the assistant, errands whose time has come
 *   3. run each one in its own folder with the chosen worker (Claude Code or Ollama)
 *   4. write the outcome to agent/results.json, commit, push
 * The app reads agent/results.json and shows the results; the runner never edits data.json.
 *
 * Usage:
 *   node scripts/agent_runner.mjs              one tick
 *   node scripts/agent_runner.mjs --dry-run    show what is due, run nothing
 *   node scripts/agent_runner.mjs --status     runner state and recent runs
 *   node scripts/agent_runner.mjs --no-push    run, but keep results local (testing)
 *
 * Settings (environment, or ~/.config/task-brain-agent/env for the service):
 *   TB_DATA_REPO      owner/repo of the private data repo   (Rumi-Shamz/task-brain-data)
 *   TB_AGENT_HOME     clone, run folders and lock           (~/.local/share/task-brain-agent)
 *   TB_CLAUDE_MODEL   model alias for Claude Code           (sonnet: easier on plan limits than opus)
 *   TB_CLAUDE_BIN     path to the claude CLI                (claude)
 *   OLLAMA_HOST       Ollama URL                            (http://127.0.0.1:11434)
 *   TB_OLLAMA_MODEL   local model                           (qwen2.5:7b)
 *   TB_MAX_RUNS       runs per tick at most                 (3)
 *   TB_TIMEOUT_MIN    minutes before a run is stopped       (20)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  RESULTS_PATH, dueWork, buildPrompt, planSnapshot, addRun, runsFor,
} from '../js/agent-core.js';
import { runClaude, runOllama } from './lib/workers.mjs';

const HEARTBEAT_MIN = 180;
const TEXT_EXT = new Set(['.md', '.txt', '.csv', '.json', '.html', '.ics', '.tsv']);
const MAX_FILE_TEXT = 40000;
const MAX_FILES_TEXT = 60000;
const MAX_OUTPUT = 30000;

export function config(env = process.env) {
  const home = env.TB_AGENT_HOME || path.join(os.homedir(), '.local/share/task-brain-agent');
  return {
    dataRepo: env.TB_DATA_REPO || 'Rumi-Shamz/task-brain-data',
    home,
    repoDir: path.join(home, 'data-repo'),
    runsDir: path.join(home, 'runs'),
    claudeModel: env.TB_CLAUDE_MODEL || 'sonnet',
    claudeBin: env.TB_CLAUDE_BIN || 'claude',
    ollamaHost: (env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    ollamaModel: env.TB_OLLAMA_MODEL || 'qwen2.5:7b',
    maxRuns: Math.max(1, Number(env.TB_MAX_RUNS) || 3),
    timeoutMs: Math.max(1, Number(env.TB_TIMEOUT_MIN) || 20) * 60000,
  };
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function acquireLock(cfg) {
  fs.mkdirSync(cfg.home, { recursive: true });
  const lock = path.join(cfg.home, 'runner.lock');
  try {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 0); return null; } catch (e) { /* stale lock: that process is gone */ }
    }
  } catch (e) { /* no lock yet */ }
  fs.writeFileSync(lock, String(process.pid));
  return () => { try { fs.unlinkSync(lock); } catch (e) {} };
}

function syncRepo(cfg) {
  if (!fs.existsSync(path.join(cfg.repoDir, '.git'))) {
    log(`cloning ${cfg.dataRepo} → ${cfg.repoDir}`);
    fs.mkdirSync(path.dirname(cfg.repoDir), { recursive: true });
    execFileSync('gh', ['repo', 'clone', cfg.dataRepo, cfg.repoDir], { stdio: 'inherit' });
    git(cfg.repoDir, 'config', 'user.name', 'task-brain-agent');
    git(cfg.repoDir, 'config', 'user.email', 'task-brain-agent@users.noreply.github.com');
  }
  git(cfg.repoDir, 'pull', '--rebase', '--autostash', '--quiet');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeResults(cfg, results) {
  const file = path.join(cfg.repoDir, RESULTS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
}

function commitAndPush(cfg, message, push) {
  git(cfg.repoDir, 'add', RESULTS_PATH);
  try { git(cfg.repoDir, 'diff', '--cached', '--quiet'); return; } catch (e) { /* there are changes */ }
  git(cfg.repoDir, 'commit', '--quiet', '-m', message);
  if (!push) return;
  // The app may save data.json between our pull and push. Different files, so a rebase is clean.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { git(cfg.repoDir, 'push', '--quiet'); return; } catch (e) {
      log(`push rejected (attempt ${attempt}), rebasing`);
      git(cfg.repoDir, 'pull', '--rebase', '--autostash', '--quiet');
    }
  }
  throw new Error('could not push agent/results.json after 3 attempts');
}

function collectFiles(dir) {
  const out = [];
  let budget = MAX_FILES_TEXT;
  const walk = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { walk(p, r); continue; }
      if (r === '_prompt.md') continue;
      const size = fs.statSync(p).size;
      const f = { name: r, size };
      if (TEXT_EXT.has(path.extname(ent.name).toLowerCase()) && size <= MAX_FILE_TEXT && size <= budget) {
        f.text = fs.readFileSync(p, 'utf8');
        budget -= size;
      }
      out.push(f);
    }
  };
  walk(dir, '');
  return out.slice(0, 20);
}

function runId() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + '-' + Math.random().toString(36).slice(2, 6);
}

async function runOne(cfg, item, payload, results) {
  const r = item.ref;
  const worker = item.kind === 'task' ? r.agentWorker : r.worker;
  const withPlan = item.kind === 'task' ? r.agentWithPlan : r.withPlan;
  const prior = runsFor(results, item.kind, r.id).filter(x => x.status === 'done');
  const prompt = buildPrompt(item, { plan: withPlan ? planSnapshot(payload) : null, previous: prior[0] || null });
  const id = runId();
  const cwd = path.join(cfg.runsDir, id);
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, '_prompt.md'), prompt);
  const startedAt = new Date().toISOString();
  log(`run ${id}: ${item.kind} "${r.name}" on ${worker}`);
  const res = worker === 'ollama'
    ? await runOllama(prompt, { host: cfg.ollamaHost, model: cfg.ollamaModel, timeoutMs: cfg.timeoutMs })
    : await runClaude(prompt, { cwd, model: cfg.claudeModel, timeoutMs: cfg.timeoutMs, bin: cfg.claudeBin });
  if (res.status === 'deferred') {
    fs.rmSync(cwd, { recursive: true, force: true });
    return { deferred: true, worker, message: res.error };
  }
  const run = {
    id, key: item.key, kind: item.kind, refId: r.id, name: r.name,
    ...(item.occurrence ? { occurrence: item.occurrence } : {}),
    worker, model: res.model || null, status: res.status,
    output: (res.output || '').slice(0, MAX_OUTPUT),
    ...(res.error ? { error: res.error } : {}),
    files: worker === 'claude' ? collectFiles(cwd) : [],
    folder: cwd,
    startedAt, finishedAt: new Date().toISOString(),
    ...(res.usage ? { usage: res.usage } : {}),
  };
  log(`run ${id}: ${run.status}${run.error ? ' — ' + run.error : ''}`);
  return { run };
}

export async function tick(cfg, { dryRun = false, push = true, now = new Date() } = {}) {
  syncRepo(cfg);
  const payload = readJson(path.join(cfg.repoDir, 'data.json'), null);
  if (!payload) { log('no data.json in the data repo yet'); return { ran: 0 }; }
  let results = readJson(path.join(cfg.repoDir, RESULTS_PATH), { version: 1, runs: [] });
  const due = dueWork(payload, results, now);
  if (dryRun) {
    due.forEach(d => log(`due: ${d.kind} "${d.ref.name}" (${d.key})`));
    if (!due.length) log('nothing due');
    return { ran: 0, due };
  }
  const runner = { ...(results.runner || {}) };
  const waiting = { ...(runner.waiting || {}) };
  const blocked = new Set();
  let ran = 0;
  let dirty = false;
  const save = message => {
    results.runner = {
      ...runner, waiting, host: os.hostname(), lastTickAt: new Date().toISOString(),
      claudeModel: cfg.claudeModel, ollamaModel: cfg.ollamaModel,
    };
    writeResults(cfg, results);
    commitAndPush(cfg, message, push);
    dirty = false;
  };
  for (const item of due) {
    if (ran >= cfg.maxRuns) break;
    const worker = item.kind === 'task' ? item.ref.agentWorker : item.ref.worker;
    if (blocked.has(worker)) continue;
    const out = await runOne(cfg, item, payload, results);
    if (out.deferred) {
      // Plan limit or Ollama down: leave the work queued and stop using that worker this tick.
      blocked.add(worker);
      if (!waiting[worker]) { waiting[worker] = { since: new Date().toISOString(), message: out.message }; dirty = true; }
      log(`${worker} unavailable, will retry: ${out.message}`);
      continue;
    }
    delete waiting[worker];
    results = addRun(results, out.run);
    ran++;
    save(`Assistant: ${out.run.status} ${out.run.kind} "${out.run.name}"`);
  }
  const heartbeatDue = Date.now() - (Date.parse(runner.lastTickAt || 0) || 0) > HEARTBEAT_MIN * 60000;
  if (dirty || (ran === 0 && heartbeatDue)) save('Assistant runner heartbeat');
  log(due.length ? `ran ${ran} of ${due.length} due` : 'nothing due');
  return { ran, due };
}

function status(cfg) {
  const results = readJson(path.join(cfg.repoDir, RESULTS_PATH), { runs: [] });
  console.log(JSON.stringify(results.runner || {}, null, 2));
  (results.runs || []).slice(0, 10).forEach(r => console.log(`${r.finishedAt}  ${r.status.padEnd(6)}  ${r.kind.padEnd(6)}  ${r.worker.padEnd(6)}  ${r.name}`));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = config();
  if (args.has('--status')) { status(cfg); return; }
  const release = acquireLock(cfg);
  if (!release) { log('another tick is still running'); return; }
  try {
    await tick(cfg, { dryRun: args.has('--dry-run'), push: !args.has('--no-push') });
  } finally {
    release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { log('runner failed:', e.message || e); process.exitCode = 1; });
}
