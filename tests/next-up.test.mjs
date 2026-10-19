import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, seedYearRhythm, normalizeTask } from '../js/state.js';
import { normalizeDayBlocks } from '../js/blocks.js';
import { dayAgenda, delegatedTasks } from '../js/next-up.js';

test('dayAgenda splits now and next across series and tasks', () => {
  state.yearRhythm = seedYearRhythm('2026-01-05');
  state.blockSkips = [];
  state.yearRhythm.dayBlocks = normalizeDayBlocks([
    { id: 'deep', name: 'Deep work', weekdays: [0, 1, 2, 3, 4], startMin: 540, endMin: 720, rule: 'leverage' },
    { id: 'swing', name: 'Swing class', weekdays: [1], startMin: 1140, endMin: 1260, rule: 'event', workDaysOnly: false },
  ]);
  state.tasks = [
    normalizeTask({ id: 'a', name: 'Grant budget', date: '2026-10-06', start: '10:00', duration: 60 }),
    normalizeTask({ id: 'b', name: 'Call venue', date: '2026-10-06', start: '14:00', duration: 30 }),
    normalizeTask({ id: 'c', name: 'Done thing', date: '2026-10-06', start: '15:00', done: true }),
  ];
  const a = dayAgenda('2026-10-06', 10 * 60 + 15);
  assert.deepEqual(a.now.map(i => i.name), ['Deep work', 'Grant budget']);
  assert.deepEqual(a.next.map(i => i.name), ['Call venue', 'Swing class']);
  assert.equal(a.openToday, 2);
});

test('delegated lists open person and assistant tasks only', () => {
  state.tasks = [
    normalizeTask({ id: 'p', name: 'Ask Anna', assignee: 'person', delegateTo: 'Anna' }),
    normalizeTask({ id: 'ai', name: 'Draft newsletter', assignee: 'ai' }),
    normalizeTask({ id: 'me', name: 'Mine' }),
    normalizeTask({ id: 'x', name: 'Bad value', assignee: 'robot' }),
    normalizeTask({ id: 'd', name: 'Done', assignee: 'person', done: true }),
  ];
  assert.deepEqual(delegatedTasks().map(t => t.id), ['p', 'ai']);
  assert.equal(state.tasks.find(t => t.id === 'x').assignee, 'me');
});

test('import accuracy ignores fields an older import did not record', async () => {
  globalThis.document = { getElementById: () => null };
  const { importHealth } = await import('../js/import-plan.js');
  state.tasks = [
    normalizeTask({ id: 'old', name: 'A', domain: 'ALFA', imported: { from: 'w40', name: 'A', domain: 'ALFA' } }),
    normalizeTask({ id: 'fix', name: 'B2', domain: 'ALFA', imported: { from: 'w40', name: 'B', domain: 'ALFA', assignee: 'me' } }),
  ];
  state.imports = [{ id: 'i1', from: 'w40', at: '2026-10-05T00:00:00Z', taskIds: ['old', 'fix', 'gone'] }];
  const [h] = importHealth();
  assert.equal(h.fixed, 1);
  assert.equal(h.deleted, 1);
  assert.deepEqual(h.fields, { name: 1 });
});
