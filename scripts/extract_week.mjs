#!/usr/bin/env node
/**
 * Weekly extraction agent (T7) — runs outside the browser.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… node scripts/extract_week.mjs path/to/transcript.txt [--week 2026-W40] [--out ./out]
 *
 * Writes week-YYYY-WW.json (plan schema) and prebrief-YYYY-WW.md.
 * Never embed API keys in the public app.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

function parseArgs(argv) {
  const args = { transcript: null, week: null, out: '.', dataJson: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--week') args.week = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--data') args.dataJson = argv[++i];
    else if (!a.startsWith('-')) args.transcript = a;
  }
  return args;
}

function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week, label: `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

function loadSchema() {
  const p = resolve('schema/plan.schema.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

async function callClaude(apiKey, transcript, weekLabel, schema) {
  const system = `You extract a weekly plan as JSON matching this schema (version 1, items array).
Domains enum: ALFA, Dorst, SwingShuffle, SwingSociety, SoftwareDev, Personal, Other.
Projects belong to domains (e.g. Swing Buzz under SwingSociety).
length must be 15, 30, 60, or 180. timepressure: urgent|important. status: todo|done|someday.
Respond with ONLY valid JSON: { "version": 1, "weekOf": "YYYY-MM-DD", "items": [ ... ] }.
Schema reference: ${JSON.stringify(schema.$defs?.planItem || schema)}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      system,
      messages: [
        {
          role: 'user',
          content: `Week ${weekLabel}. Transcript:\n\n${transcript}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`);
  }
  const body = await res.json();
  const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in model response');
  return JSON.parse(match[0]);
}

function buildPrebrief(weekLabel, plan, prevData) {
  const lines = [`# Prebrief ${weekLabel}`, ''];
  const items = plan.items || [];
  const done = items.filter(i => i.status === 'done').length;
  const planned = items.length;
  lines.push(`## Plan snapshot`);
  lines.push(`- Items: ${planned} (${done} marked done in extract)`);
  lines.push('');

  if (prevData && prevData.tasks) {
    const tasks = prevData.tasks;
    const byDomain = {};
    let total = 0, lMins = 0;
    tasks.forEach(t => {
      if (!t.date || !t.start) return;
      const dur = t.duration || 30;
      total += dur;
      if (t.lno === 'L') lMins += dur;
      const d = t.domain || 'Other';
      byDomain[d] = (byDomain[d] || 0) + dur;
    });
    lines.push(`## Last week (from data.json)`);
    lines.push(`- Scheduled minutes: ${total}`);
    lines.push(`- % on L: ${total ? Math.round((lMins / total) * 100) : 0}%`);
    lines.push(`- Hours by domain:`);
    Object.entries(byDomain).sort((a, b) => b[1] - a[1]).forEach(([d, m]) => {
      lines.push(`  - ${d}: ${(m / 60).toFixed(1)}h`);
    });
    const somedayDue = tasks.filter(t => t.status === 'someday' && t.reviewAt);
    lines.push(`- Someday items with reviewAt: ${somedayDue.length}`);
    const donePrev = tasks.filter(t => t.done || t.status === 'done').length;
    lines.push(`- Done tasks in store: ${donePrev}`);
  } else {
    lines.push(`## Last week`);
    lines.push(`_No data.json provided — pass --data path/to/data.json for stats._`);
  }
  lines.push('');
  lines.push(`## Focus prompts`);
  lines.push(`1. What L work moves the needle this week?`);
  lines.push(`2. Which someday items are due for a decision?`);
  lines.push(`3. Any schedule-quadrant skills needing a Learn block?`);
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.transcript) {
    console.error('Usage: node scripts/extract_week.mjs transcript.txt [--week 2026-W40] [--out dir] [--data data.json]');
    process.exit(1);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY in the environment (never commit it).');
    process.exit(1);
  }
  const week = args.week || isoWeek().label;
  const transcript = readFileSync(resolve(args.transcript), 'utf8');
  const schema = loadSchema();
  console.error(`Extracting ${week}…`);
  const plan = await callClaude(apiKey, transcript, week, schema);
  if (!plan.version) plan.version = 1;
  mkdirSync(resolve(args.out), { recursive: true });
  const planPath = join(resolve(args.out), `week-${week}.json`);
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
  console.error(`Wrote ${planPath}`);

  let prev = null;
  if (args.dataJson && existsSync(args.dataJson)) {
    prev = JSON.parse(readFileSync(args.dataJson, 'utf8'));
  }
  const briefPath = join(resolve(args.out), `prebrief-${week}.md`);
  writeFileSync(briefPath, buildPrebrief(week, plan, prev));
  console.error(`Wrote ${briefPath}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
