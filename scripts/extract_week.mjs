#!/usr/bin/env node
/**
 * Weekly extraction agent (T7) — runs outside the browser.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=… node scripts/extract_week.mjs transcript.txt [--week 2026-W41] [--out dir] [--data data.json]
 *   LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:7b node scripts/extract_week.mjs transcript.txt …   (local model)
 *   node scripts/extract_week.mjs --prebrief-only --data data.json [--week 2026-W41]       (no model call)
 *
 * Writes week-YYYY-WNN.json (schema/plan.schema.json, validated) and prebrief-YYYY-WNN.md.
 * Never embed API keys in the public app.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateJson, providerConfig } from './lib/llm.mjs';
import { isoWeek, mondayOfIsoWeek, ymd, extractionContext, buildPrebrief } from './lib/week.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { transcript: null, week: null, out: '.', dataJson: null, prebriefOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--week') args.week = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--data') args.dataJson = argv[++i];
    else if (a === '--prebrief-only') args.prebriefOnly = true;
    else if (!a.startsWith('-')) args.transcript = a;
  }
  return args;
}

export function loadSchema() {
  return JSON.parse(readFileSync(join(ROOT, 'schema/plan.schema.json'), 'utf8'));
}

export function extractionSystemPrompt(schema, weekLabel, context) {
  const domains = schema.$defs.domain.enum.join(', ');
  return `You turn the owner's spoken weekly planning session into the week plan for ${weekLabel} (Monday ${ymd(mondayOfIsoWeek(weekLabel))}).

The owner runs several ventures. Domains: ${domains}. A project belongs to one domain (e.g. "Swing Buzz" is a project under SwingSociety, not a domain).
Each item is one task the owner decided on. Use:
- activity: research (research/plan), communicate (calls, emails, delegating to people), act (doing the work), learn (study/practice).
- lno: L = high-leverage, give it the best energy; N = do it well enough; O = minimize, batch or delegate. Omit if unclear.
- length in minutes: 15, 30, 60 or 180 — pick the closest to what was said.
- weekday: set it whenever the owner names a day ("Monday morning" → monday, "Thursday evening" → thursday).
- slot: morning, afternoon or evening whenever the owner names a time of day; with a weekday but no time of day, use morning.
- status: omit it for normal tasks this week. Use "done" only for things reported as already finished, and "someday" only for ideas the owner explicitly parks for later ("someday", "maybe", "not now").
- project: when a named project is mentioned (e.g. "for Swing Buzz"), put it in project and leave it out of the name.
- priority 0–3 (3 = most important) and timepressure (urgent | important) when stated or clearly implied.
Keep task names short and imperative, in the owner's words. Do not invent tasks that were not discussed.
${context ? `\n${context}\n` : ''}
Return only the JSON object with version 1, weekOf ${ymd(mondayOfIsoWeek(weekLabel))}, and items.`;
}

async function main() {
  const args = parseArgs(process.argv);
  const week = args.week || isoWeek();
  mondayOfIsoWeek(week); // throws on a malformed label
  const data = args.dataJson && existsSync(args.dataJson) ? JSON.parse(readFileSync(args.dataJson, 'utf8')) : null;
  mkdirSync(resolve(args.out), { recursive: true });

  if (!args.prebriefOnly) {
    if (!args.transcript) {
      console.error('Usage: node scripts/extract_week.mjs transcript.txt [--week 2026-W41] [--out dir] [--data data.json]');
      process.exit(1);
    }
    const transcript = readFileSync(resolve(args.transcript), 'utf8');
    const schema = loadSchema();
    const cfg = providerConfig();
    console.error(`Extracting ${week} with ${cfg.provider}/${cfg.model}…`);
    const { value: plan, attempts } = await generateJson({
      system: extractionSystemPrompt(schema, week, extractionContext(data)),
      input: `Transcript:\n\n${transcript}`,
      schema,
      cfg,
    });
    plan.weekOf = ymd(mondayOfIsoWeek(week));
    const planPath = join(resolve(args.out), `week-${week}.json`);
    writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
    console.error(`Wrote ${planPath} (${plan.items.length} items, ${attempts} attempt${attempts > 1 ? 's' : ''})`);
  }

  const briefPath = join(resolve(args.out), `prebrief-${week}.md`);
  writeFileSync(briefPath, buildPrebrief(data, week));
  console.error(`Wrote ${briefPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
