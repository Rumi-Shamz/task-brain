import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, normalizeTask } from '../js/state.js';
import { deferTargets, deferTask } from '../js/defer.js';
import { weekReview } from '../scripts/lib/week.mjs';

test('defer targets: next week work days, +1 week / month / 3 months on work days', () => {
  state.yearRhythm = null; // every weekday is a work day
  const t = normalizeTask({ id: 'a', name: 'Call', date: '2026-10-29', start: '10:00' }); // Thursday
  const to = deferTargets(t, '2026-10-29');
  assert.deepEqual(to.nextWeek, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  assert.equal(to.week, '2026-11-05');
  assert.equal(to.month, '2026-11-30', '29 Nov is a Sunday → Monday 30');
  assert.equal(to.quarter, '2027-01-29');
  const end = deferTargets(normalizeTask({ id: 'b', name: 'B', date: '2027-01-29' }), '2027-01-29');
  assert.equal(end.month, '2027-03-01', '28 Feb 2027 is a Sunday; never past the month end otherwise');
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
