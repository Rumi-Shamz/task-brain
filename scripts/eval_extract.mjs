#!/usr/bin/env node
/**
 * Score the weekly extractor against hand-checked weeks, to compare models (Claude vs local).
 *
 *   node scripts/eval_extract.mjs --cases path/to/cases [--save results.json]
 *   LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:7b node scripts/eval_extract.mjs --cases …
 *
 * A case is a folder with transcript.txt and expected.json (a plan you corrected by hand),
 * plus an optional data.json snapshot from before that session. Keep real cases in the
 * private data repo; evals/extract/sample is synthetic.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateJson, providerConfig } from './lib/llm.mjs';
import { isoWeek, extractionContext, realDate, flagValue } from './lib/week.mjs';
import { loadSchema, extractionSystemPrompt } from './extract_week.mjs';

export const FIELDS = ['domain', 'project', 'activity', 'lno', 'length', 'weekday', 'slot', 'status'];

const words = s => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1));
export function nameSimilarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  A.forEach(w => { if (B.has(w)) common++; });
  return common / (A.size + B.size - common);
}

const norm = (field, v) => (v == null || v === '' ? (field === 'status' ? 'todo' : null) : String(v).toLowerCase());

/** Greedy best-first pairing of expected and extracted items by name. */
export function scoreCase(expectedItems, gotItems, threshold = 0.34) {
  const pairs = [];
  expectedItems.forEach((e, i) => gotItems.forEach((g, j) => {
    const s = nameSimilarity(e.name, g.name);
    if (s >= threshold) pairs.push({ i, j, s });
  }));
  pairs.sort((a, b) => b.s - a.s);
  const usedE = new Set(), usedG = new Set(), matched = [];
  pairs.forEach(p => {
    if (usedE.has(p.i) || usedG.has(p.j)) return;
    usedE.add(p.i); usedG.add(p.j);
    matched.push([expectedItems[p.i], gotItems[p.j]]);
  });
  const fields = {};
  FIELDS.forEach(f => {
    // Every matched pair counts: a field the expected plan leaves out must also be left out by the extractor.
    const ok = matched.filter(([e, g]) => norm(f, e[f]) === norm(f, g[f])).length;
    fields[f] = { ok, of: matched.length };
  });
  return {
    expected: expectedItems.length,
    extracted: gotItems.length,
    matched: matched.length,
    missing: expectedItems.filter((_, i) => !usedE.has(i)).map(e => e.name),
    extra: gotItems.filter((_, j) => !usedG.has(j)).map(g => g.name),
    fields,
  };
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

async function main() {
  const argv = process.argv.slice(2);
  const casesDir = resolve(argv.includes('--cases') ? flagValue(argv, argv.indexOf('--cases'), '--cases') : 'evals/extract');
  const savePath = argv.includes('--save') ? flagValue(argv, argv.indexOf('--save'), '--save') : null;
  const cfg = providerConfig();
  const schema = loadSchema();
  const cases = readdirSync(casesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(casesDir, d.name, 'expected.json')))
    .map(d => d.name).sort();
  if (!cases.length) throw new Error(`No cases with expected.json under ${casesDir}`);
  console.log(`Model ${cfg.provider}/${cfg.model} · ${cases.length} case(s)\n`);

  const totals = { expected: 0, extracted: 0, matched: 0, fields: {}, failed: 0, ms: 0 };
  FIELDS.forEach(f => { totals.fields[f] = { ok: 0, of: 0 }; });
  const results = [];
  for (const name of cases) {
    const dir = join(casesDir, name);
    const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    const data = existsSync(join(dir, 'data.json')) ? JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) : null;
    if (expected.weekOf && !realDate(expected.weekOf)) throw new Error(`${name}/expected.json: weekOf "${expected.weekOf}" is not a real YYYY-MM-DD date`);
    const week = expected.weekOf ? isoWeek(realDate(expected.weekOf)) : isoWeek();
    const t0 = Date.now();
    try {
      const { value } = await generateJson({
        system: extractionSystemPrompt(schema, week, extractionContext(data)),
        input: `Transcript:\n\n${readFileSync(join(dir, 'transcript.txt'), 'utf8')}`,
        schema, cfg,
      });
      const ms = Date.now() - t0;
      const s = scoreCase(expected.items, value.items);
      results.push({ name, ms, ...s });
      totals.expected += s.expected; totals.extracted += s.extracted; totals.matched += s.matched; totals.ms += ms;
      FIELDS.forEach(f => { totals.fields[f].ok += s.fields[f].ok; totals.fields[f].of += s.fields[f].of; });
      console.log(`${name}: recall ${pct(s.matched, s.expected)} · precision ${pct(s.matched, s.extracted)} · ${(ms / 1000).toFixed(1)}s`);
      if (s.missing.length) console.log(`  missing: ${s.missing.join('; ')}`);
      if (s.extra.length) console.log(`  extra:   ${s.extra.join('; ')}`);
    } catch (e) {
      totals.failed++;
      results.push({ name, error: e.message });
      console.log(`${name}: FAILED — ${e.message.split('\n')[0]}`);
    }
  }
  console.log(`\nOverall: recall ${pct(totals.matched, totals.expected)} · precision ${pct(totals.matched, totals.extracted)} · failed ${totals.failed}`);
  console.log(FIELDS.map(f => `${f} ${pct(totals.fields[f].ok, totals.fields[f].of)}`).join(' · '));
  if (savePath) {
    writeFileSync(savePath, JSON.stringify({ provider: cfg.provider, model: cfg.model, totals, results }, null, 2) + '\n');
    console.log(`Saved ${savePath}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
