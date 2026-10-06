import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { validate, schemaForModel, stripNulls } from '../scripts/lib/validate.mjs';
import { mondayOfIsoWeek, ymd, previousWeek, weekReview, buildPrebrief, extractionContext } from '../scripts/lib/week.mjs';
import { scoreCase, nameSimilarity } from '../scripts/eval_extract.mjs';

const schema = JSON.parse(readFileSync(new URL('../schema/plan.schema.json', import.meta.url)));

test('plan schema accepts the sample and rejects bad items', () => {
  const sample = JSON.parse(readFileSync(new URL('../evals/extract/sample/expected.json', import.meta.url)));
  assert.deepEqual(validate(schema, sample), []);
  const errs = validate(schema, { version: 1, items: [{ name: '', domain: 'Mars', length: 45, extra: 1 }] });
  assert.ok(errs.some(e => e.includes('/items/0/name')));
  assert.ok(errs.some(e => e.includes('/items/0/domain')));
  assert.ok(errs.some(e => e.includes('/items/0/length')));
  assert.ok(errs.some(e => e.includes('unexpected extra')));
});

test('model schema inlines refs, drops unsupported keywords, makes optionals nullable', () => {
  const w = schemaForModel(schema);
  const item = w.properties.items.items;
  assert.equal(JSON.stringify(w).includes('$ref'), false);
  assert.equal(JSON.stringify(w).includes('minLength'), false);
  assert.deepEqual(item.required, Object.keys(item.properties));
  assert.deepEqual(item.properties.weekday.anyOf[1], { type: 'null' });
  assert.deepEqual(stripNulls({ a: null, b: '', c: { d: null, e: 1 } }), { c: { e: 1 } });
});

test('ISO week helpers', () => {
  assert.equal(ymd(mondayOfIsoWeek('2026-W41')), '2026-10-05');
  assert.equal(ymd(mondayOfIsoWeek('2027-W01')), '2027-01-04');
  assert.equal(previousWeek('2026-W01'), '2025-W52');
  assert.equal(previousWeek('2021-W01'), '2020-W53');
});

const data = {
  projects: [{ id: 'buzz', name: 'Swing Buzz', domain: 'SwingSociety' }],
  skills: [{ name: 'Python async', quadrant: 'schedule' }],
  tasks: [
    { id: 'a', name: 'Grant budget', date: '2026-10-06', done: true, duration: 180, lno: 'L', domain: 'ALFA' },
    { id: 'b', name: 'Venue email', date: '2026-10-13', missed: ['2026-10-07'], duration: 30, domain: 'SwingSociety' },
    { id: 'c', name: 'Old', date: '2026-09-01', done: true, duration: 60 },
    { id: 'd', name: 'Newsletter', status: 'someday', reviewAt: '2026-10-14' },
  ],
};

test('weekReview counts planned, done and missed inside the week only', () => {
  const r = weekReview(data, '2026-W41');
  assert.deepEqual(r.planned.map(t => t.id).sort(), ['a', 'b']);
  assert.deepEqual(r.done.map(t => t.id), ['a']);
  assert.deepEqual(r.missed.map(t => t.id), ['b']);
  assert.equal(r.lPercent, 100);
});

test('prebrief covers last week, slipped, someday due and skills', () => {
  const md = buildPrebrief(data, '2026-W42');
  assert.match(md, /Done 1 of 2 planned \(50%\)/);
  assert.match(md, /## Slipped[\s\S]*Venue email/);
  assert.match(md, /## Someday[\s\S]*Newsletter/);
  assert.match(md, /Python async \(schedule\)/);
  assert.match(extractionContext(data), /Swing Buzz \(domain SwingSociety\)/);
});

test('eval scoring pairs items by name and scores fields', () => {
  assert.ok(nameSimilarity('Email venue about October social', 'email Swing Buzz venue about October social') > 0.5);
  const s = scoreCase(
    [{ name: 'Call dentist', domain: 'Personal', length: 15 }, { name: 'Write report', domain: 'ALFA' }],
    [{ name: 'call the dentist', domain: 'Personal', length: 30 }, { name: 'Buy milk', domain: 'Personal' }],
  );
  assert.equal(s.matched, 1);
  assert.deepEqual(s.missing, ['Write report']);
  assert.deepEqual(s.extra, ['Buy milk']);
  assert.deepEqual(s.fields.length, { ok: 0, of: 1 });
  assert.deepEqual(s.fields.domain, { ok: 1, of: 1 });
});

import { realDate, flagValue } from '../scripts/lib/week.mjs';
import { execFileSync, spawnSync } from 'node:child_process';

test('realDate rejects dates JavaScript would roll over', () => {
  assert.ok(realDate('2026-10-12'));
  assert.equal(realDate('2026-02-31'), null);
  assert.equal(realDate('2026-13-01'), null);
  assert.equal(realDate('tomorrow'), null);
});

test('flags need a value', () => {
  assert.equal(flagValue(['--cases', 'dir'], 0, '--cases'), 'dir');
  assert.throws(() => flagValue(['--cases'], 0, '--cases'), /needs a value/);
  assert.throws(() => flagValue(['--cases', '--save', 'x'], 0, '--cases'), /needs a value/);
});

test('eval scoring penalises a field the expected plan leaves out', () => {
  const s = scoreCase([{ name: 'Call dentist', domain: 'Personal' }], [{ name: 'Call dentist', domain: 'Personal', weekday: 'monday' }]);
  assert.deepEqual(s.fields.domain, { ok: 1, of: 1 });
  assert.deepEqual(s.fields.weekday, { ok: 0, of: 1 });
});

test('extract_week stops on a --data file that does not exist, and on a flag without a value', () => {
  const run = args => spawnSync(process.execPath, ['scripts/extract_week.mjs', '--prebrief-only', '--out', '/tmp/tb-test-out', ...args], { encoding: 'utf8' });
  const missing = run(['--data', '/tmp/tb-no-such-file.json']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--data file not found/);
  const noValue = run(['--week']);
  assert.notEqual(noValue.status, 0);
  assert.match(noValue.stderr, /--week needs a value/);
  assert.equal(run([]).status, 0, 'no --data is still fine');
});
