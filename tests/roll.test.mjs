import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, normalizeTask, seedYearRhythm } from '../js/state.js';
import { rollOpenTasksForward, slippedTasks } from '../js/blocks.js';

test('rolling forward records each missed date once', () => {
  state.yearRhythm = seedYearRhythm('2026-01-05');
  state.tasks = [
    normalizeTask({ id: 'm', name: 'Missed', date: '2026-09-28' }),
    normalizeTask({ id: 'd', name: 'Done', date: '2026-09-28', done: true }),
    normalizeTask({ id: 'f', name: 'Future', date: '2026-12-01' }),
  ];
  const today = new Date(2026, 9, 6);
  rollOpenTasksForward(today);
  rollOpenTasksForward(today);
  const m = state.tasks.find(t => t.id === 'm');
  assert.deepEqual(m.missed, ['2026-09-28']);
  assert.ok(m.date >= '2026-10-06');
  assert.deepEqual(state.tasks.find(t => t.id === 'd').missed, []);
  assert.deepEqual(slippedTasks().map(t => t.id), ['m']);
});
