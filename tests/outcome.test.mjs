import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, normalizeTask } from '../js/state.js';
import { needsOutcome, isLocked, recordOutcome, blockerCandidates, dependentsOf } from '../js/outcome.js';
import { buildPrebrief } from '../scripts/lib/week.mjs';

test('only bigger tasks ask for an outcome', () => {
  state.tasks = [
    normalizeTask({ id: 's', name: 'Small', size: 'simple', projectId: 'p' }),
    normalizeTask({ id: 'n', name: 'No project, no size' }),
    normalizeTask({ id: 'm', name: 'Mid', size: 'mid' }),
    normalizeTask({ id: 'p', name: 'In a project', projectId: 'p' }),
    normalizeTask({ id: 'b', name: 'Something waits on it', size: 'simple' }),
    normalizeTask({ id: 'w', name: 'Waits', blockedBy: ['b'] }),
  ];
  const ask = state.tasks.filter(needsOutcome).map(t => t.id);
  assert.deepEqual(ask, ['m', 'p', 'b']);
});

test('a task is locked until what it waits on is done; follow-ups wait on the finished task', () => {
  state.tasks = [
    normalizeTask({ id: 'a', name: 'Build DJ program', projectId: 'dj', domain: 'SwingSociety' }),
    normalizeTask({ id: 'b', name: 'Participant comms', blockedBy: ['a'], domain: 'SwingSociety' }),
  ];
  assert.equal(isLocked(state.tasks[1]), true);
  assert.equal(blockerCandidates(state.tasks[0]).some(t => t.id === 'b'), false, 'no cycles: b already waits on a');
  state.tasks[0].done = true;
  assert.equal(isLocked(state.tasks[1]), false);
  const [f] = recordOutcome('a', { result: 'partial', note: ' Program drafted, sessions open ', followUps: ['Schedule sessions', ' '] });
  assert.deepEqual(state.tasks[0].outcome, { result: 'partial', note: 'Program drafted, sessions open' });
  assert.equal(f.name, 'Schedule sessions');
  assert.deepEqual(f.blockedBy, ['a']);
  assert.equal(f.projectId, 'dj');
  assert.deepEqual(dependentsOf('a').map(t => t.id), ['b', f.id]);
});

test('the review shows the outcome and what it unlocked', () => {
  const md = buildPrebrief({ tasks: [
    { id: 'a', name: 'Build DJ program', done: true, doneAt: new Date(2026, 9, 21, 10).toISOString(), outcome: { result: 'planned', note: 'Ready' } },
    { id: 'b', name: 'Participant comms', blockedBy: ['a'] },
  ] }, '2026-W44');
  assert.match(md, /- Outcome: done as planned — Ready/);
  assert.match(md, /- Unlocks: Participant comms/);
});
