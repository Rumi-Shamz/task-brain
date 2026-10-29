import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, normalizeTask } from '../js/state.js';
import { deferTargets, deferTask } from '../js/defer.js';
import { weekReview } from '../scripts/lib/week.mjs';
import { slippedTasks } from '../js/blocks.js';

test('next week / next month move by 7 / 28 days and keep the weekday', () => {
  const t = normalizeTask({ id: 'a', name: 'Call', date: '2026-10-29', start: '10:00' }); // Thursday
  assert.deepEqual(deferTargets(t, '2026-10-29'), { week: '2026-11-05', month: '2026-11-26' });
  assert.deepEqual(deferTargets(normalizeTask({ id: 'b', name: 'No day' }), '2026-10-29'), { week: '2026-11-05', month: '2026-11-26' });
});

test('deferring keeps the time, records the day it left, and the review lists it as deferred', () => {
  state.yearRhythm = null;
  state.tasks = [normalizeTask({ id: 'a', name: 'Lawyer', date: '2026-10-29', start: '10:00' }),
    normalizeTask({ id: 'b', name: 'Bank', date: '2026-10-28', start: '09:00' })];
  deferTask('a', '2026-11-05');
  deferTask('b', null);
  const [a, b] = state.tasks;
  assert.equal(a.date, '2026-11-05');
  assert.equal(a.start, '10:00');
  assert.deepEqual(a.deferred, ['2026-10-29']);
  assert.equal(b.status, 'someday');
  assert.equal(b.date, null);
  assert.deepEqual(b.deferred, ['2026-10-28']);
  const r = weekReview({ tasks: state.tasks }, '2026-W44');
  assert.deepEqual(r.deferred.map(t => t.id), ['a', 'b']);
  assert.deepEqual(r.missed, []);
  assert.deepEqual(r.planned, [], 'deferred tasks no longer count as planned for the week they left');
});

test('scheduling a backlog item takes it out of the backlog', () => {
  state.tasks = [normalizeTask({ id: 'c', name: 'Parked', status: 'someday', reviewAt: '2026-11-10', reviewSkips: 2 })];
  deferTask('c', '2026-11-05');
  const [c] = state.tasks;
  assert.equal(c.status, 'todo');
  assert.equal(c.date, '2026-11-05');
  assert.equal(c.reviewAt, null);
  assert.equal(c.reviewSkips, 0);
});

test('picking a day for a slipped task takes it out of Needs you until it slips again', () => {
  state.yearRhythm = null;
  state.tasks = [normalizeTask({ id: 's', name: 'Website', date: '2026-10-29', missed: ['2026-10-22', '2026-10-27'] })];
  assert.deepEqual(slippedTasks().map(t => t.id), ['s']);
  deferTask('s', '2026-11-05');
  assert.equal(state.tasks[0].slipHandled, '2026-10-27');
  assert.deepEqual(slippedTasks(), []);
  state.tasks[0].missed.push('2026-11-05');
  assert.deepEqual(slippedTasks().map(t => t.id), ['s']);
  assert.equal(normalizeTask(state.tasks[0]).slipHandled, '2026-10-27');
});
