import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, normalizeTask } from '../js/state.js';
import { recoveryFor, recoveryMinutes, recoveriesOnDate } from '../js/recovery.js';

test('only tasks longer than 30 minutes get a break, longer work a longer one', () => {
  assert.equal(recoveryMinutes(30), 0);
  assert.equal(recoveryMinutes(45), 5);
  assert.equal(recoveryMinutes(60), 5);
  assert.equal(recoveryMinutes(120), 10);
  assert.equal(recoveryMinutes(180), 15);
});

test('the kind of break follows the kind of work', () => {
  const t = extra => normalizeTask({ id: 'x', name: 'X', date: '2026-10-29', start: '09:00', duration: 120, ...extra });
  assert.equal(recoveryFor(t({ activity: 'research' })).kind, 'walk');
  assert.equal(recoveryFor(t({ activity: 'act' })).kind, 'coffee');
  assert.equal(recoveryFor(t({ activity: 'research', draining: true })).kind, 'coffee');
  assert.equal(recoveryFor(t({ activity: 'communicate' })).kind, 'quiet');
  const r = recoveryFor(t({ activity: 'research' }));
  assert.equal(r.start, 11 * 60);
  assert.equal(r.end, 11 * 60 + 10);
  assert.equal(recoveryFor(t({ recovery: 'skip' })), null);
});

test('no break is suggested over the next scheduled task', () => {
  state.tasks = [
    normalizeTask({ id: 'a', name: 'Research', activity: 'research', date: '2026-10-29', start: '09:00', duration: 120 }),
    normalizeTask({ id: 'b', name: 'Call', date: '2026-10-29', start: '11:00', duration: 30 }),
    normalizeTask({ id: 'c', name: 'Build', activity: 'act', date: '2026-10-29', start: '14:00', duration: 60 }),
  ];
  assert.deepEqual(recoveriesOnDate('2026-10-29').map(x => x.t.id), ['c']);
});

test('a break shows as Now right after the task, never in the next list', async () => {
  const { dayAgenda } = await import('../js/next-up.js');
  state.yearRhythm = null;
  state.tasks = [
    normalizeTask({ id: 'a', name: 'Research', activity: 'research', date: '2026-10-29', start: '09:00', duration: 120 }),
    normalizeTask({ id: 'b', name: 'Call', date: '2026-10-29', start: '15:00', duration: 30 }),
  ];
  const mine = list => list.filter(i => i.kind === 'task' || i.kind === 'recovery');
  assert.deepEqual(mine(dayAgenda('2026-10-29', 8 * 60).next).map(i => i.name), ['Research']);
  assert.deepEqual(mine(dayAgenda('2026-10-29', 11 * 60 + 2).now).map(i => i.kind), ['recovery']);
});
