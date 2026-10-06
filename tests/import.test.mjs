import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { getElementById: () => null };
const { state, seedYearRhythm, formatYmd } = await import('../js/state.js');
const I = await import('../js/import-plan.js');
state.yearRhythm = seedYearRhythm('2025-12-29');

const CSV = `Key word,Domain,Priority,Timepressure,allotted time,allotted day,length,sessions,Description
Festival Bar Construction,SwingBuzz,3.0,urgent,Afternoon,Tuesday,180.0,1.0,Construct bar.
ALFA plan preparation ✕,,,,,,,,
Swing Buzz: Bus rental ✕,,,,,,,,
Dorst Terms define ✕,,,,,,,,
List of Beta countries,,,,,,,,
Dump,ALFA,,,,,,,GPS trackers in cars
Dump,Swing Society,,,,,,,MustArt Short Film & Music Fest`;

test('domains are read from task names; finished items do not warn about planning fields', () => {
  const { tasks, rows } = I.validateAndBuildItems(I.csvRowsToItems(I.parseCsvText(CSV)), { monday: new Date(2026, 9, 12) });
  const by = name => tasks.find(t => t.name === name);
  assert.equal(by('ALFA plan preparation').domain, 'ALFA');
  assert.equal(by('Swing Buzz: Bus rental').domain, 'SwingSociety');
  assert.equal(by('Dorst Terms define').domain, 'Dorst');
  assert.equal(by('Dorst Terms define').status, 'done');
  const warnFor = name => rows.filter(r => r.level === 'warn' && r.message.endsWith(`("${name}")`)).map(r => r.message);
  assert.deepEqual(warnFor('Dorst Terms define'), [], 'done + domain from name → no warnings');
  assert.deepEqual(warnFor('List of Beta countries'), [
    'missing domain → Personal / Unassigned ("List of Beta countries")',
    'priority missing → 0 ("List of Beta countries")',
    'length missing/invalid → 30 ("List of Beta countries")',
  ], 'one domain warning, not two');
});

test('two Dump rows with different notes are both imported', () => {
  state.tasks = []; state.imports = [];
  const { tasks, rows } = I.validateAndBuildItems(I.csvRowsToItems(I.parseCsvText(CSV)), { monday: new Date(2026, 9, 12) });
  assert.equal(I.commitImportedTasks(tasks, rows), 7);
  assert.equal(state.tasks.filter(t => t.name === 'Dump').length, 2);
  assert.equal(I.commitImportedTasks(tasks, rows), 0, 're-importing the same file adds nothing');
});

test('default import week: this week Mon–Thu, next week from Friday', () => {
  assert.equal(formatYmd(I.defaultImportMonday(new Date(2026, 9, 7))), '2026-10-05'); // Wed
  assert.equal(formatYmd(I.defaultImportMonday(new Date(2026, 9, 9))), '2026-10-12'); // Fri
  assert.equal(formatYmd(I.defaultImportMonday(new Date(2026, 9, 11))), '2026-10-12'); // Sun
});
