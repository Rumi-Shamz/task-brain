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

test('template columns: size, activity, LNO, who and an exact start time', () => {
  const CSV = [
    'Key word,Domain,Project,Priority,Timepressure,Allotted time,Allotted day,Start,Length,Size,Activity,LNO,Who,Description',
    'Boss meeting,Dorst,Adoption,3,important,afternoon,monday,15:30,60,mid,communicate,L,me,Credentials',
    'Venue research,SwingSociety,Events,2,,,,,60,simple,research,,assistant,Three venues in Utrecht',
    'Draft summary,Dev,Notes,1,,,,,30,,,,local,',
    'Call DJ,SwingSociety,DJ,2,,,,,15,,,,Anna,',
    'Training plan,SwingSociety,DJ,2,,afternoon,,,60,complex,,,,No day yet',
  ].join('\n');
  const { tasks, rows } = I.validateAndBuildItems(I.csvRowsToItems(I.parseCsvText(CSV)), { monday: new Date(2026, 9, 19) });
  assert.equal(tasks.length, 5, 'a time of day without a day no longer skips the row');
  const [boss, venue, draft, call, training] = tasks;
  assert.equal(boss.date, '2026-10-19');
  assert.equal(boss.start, '15:30');
  assert.equal(boss.size, 'mid', 'size column beats priority');
  assert.equal(boss.activity, 'communicate');
  assert.equal(boss.lno, 'L');
  assert.equal(boss.assignee, 'me');
  assert.equal(venue.assignee, 'ai');
  assert.equal(venue.agentWorker, 'claude');
  assert.equal(venue.activity, 'research');
  assert.equal(draft.agentWorker, 'ollama');
  assert.equal(call.assignee, 'person');
  assert.equal(call.delegateTo, 'Anna');
  assert.equal(training.date, null);
  assert.equal(training.size, 'complex');
  assert.ok(rows.some(r => r.level === 'warn' && /time without a day/.test(r.message)));
  assert.ok(!rows.some(r => r.level === 'error'));
});
