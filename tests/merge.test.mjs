import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import { markClean, stampChanges, mergePayloads, pruneTombstones } from '../js/merge.js';

function payload(extra = {}) {
  return {
    version: 9, tasks: [], groups: [], projects: [], skills: [], customProjects: [], customDomains: [],
    activityRules: [], yearHourLogs: [], blockSkips: [], yearRhythm: { version: 1, dayBlocks: [] },
    tombstones: [], settingsUpdatedAt: null, groupCounter: 0, collapsedDomains: null, ...extra,
  };
}

test('stampChanges stamps edited and new records, tombstones removed ones', () => {
  state.tombstones = [];
  const p = payload({ tasks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  markClean(p);
  p.tasks[0].name = 'A2';
  p.tasks.splice(1, 1);
  p.tasks.push({ id: 'c', name: 'C' });
  assert.equal(stampChanges(p, '2026-10-06T10:00:00.000Z'), true);
  assert.equal(p.tasks[0].updatedAt, '2026-10-06T10:00:00.000Z');
  assert.equal(p.tasks[1].updatedAt, '2026-10-06T10:00:00.000Z');
  assert.deepEqual(state.tombstones, [{ c: 'tasks', id: 'b', at: '2026-10-06T10:00:00.000Z' }]);
  assert.equal(stampChanges(p, '2026-10-06T11:00:00.000Z'), false, 'no change → no stamp');
});

test('merge keeps edits from both devices to different tasks', () => {
  const local = payload({ tasks: [
    { id: 'a', name: 'A local', updatedAt: '2026-10-06T10:00:00Z' },
    { id: 'b', name: 'B', updatedAt: '2026-10-01T00:00:00Z' },
  ] });
  const remote = payload({ tasks: [
    { id: 'a', name: 'A', updatedAt: '2026-10-01T00:00:00Z' },
    { id: 'b', name: 'B remote', updatedAt: '2026-10-06T09:00:00Z' },
    { id: 'c', name: 'C new on phone', updatedAt: '2026-10-06T09:30:00Z' },
  ] });
  const m = mergePayloads(local, remote);
  assert.deepEqual(m.tasks.map(t => t.name), ['A local', 'B remote', 'C new on phone']);
});

test('merge honours deletions from either side unless edited later', () => {
  const local = payload({
    tasks: [{ id: 'keep', name: 'edited after delete', updatedAt: '2026-10-06T12:00:00Z' }],
    tombstones: [{ c: 'tasks', id: 'gone', at: '2026-10-06T10:00:00Z' }],
  });
  const remote = payload({
    tasks: [{ id: 'gone', name: 'old', updatedAt: '2026-10-05T00:00:00Z' }],
    tombstones: [{ c: 'tasks', id: 'keep', at: '2026-10-06T11:00:00Z' }],
  });
  const m = mergePayloads(local, remote);
  assert.deepEqual(m.tasks.map(t => t.id), ['keep']);
});

test('ties prefer the remote copy; settings follow the newer settingsUpdatedAt', () => {
  const local = payload({ tasks: [{ id: 'a', name: 'L' }], collapsedDomains: ['ALFA'], settingsUpdatedAt: '2026-10-06T12:00:00Z', groupCounter: 3 });
  const remote = payload({ tasks: [{ id: 'a', name: 'R' }], collapsedDomains: [], settingsUpdatedAt: '2026-10-06T08:00:00Z', groupCounter: 5 });
  const m = mergePayloads(local, remote);
  assert.equal(m.tasks[0].name, 'R');
  assert.deepEqual(m.collapsedDomains, ['ALFA']);
  assert.equal(m.groupCounter, 5);
});

test('nested dayBlocks and keyed blockSkips merge', () => {
  const local = payload({
    yearRhythm: { version: 1, cycles: [1], dayBlocks: [{ id: 'deep', name: 'Deep L', updatedAt: '2026-10-06T10:00:00Z' }] },
    blockSkips: [{ date: '2026-10-07', blockId: 'deep', updatedAt: '2026-10-06T10:00:00Z' }],
  });
  const remote = payload({
    yearRhythm: { version: 1, cycles: [2], dayBlocks: [{ id: 'deep', name: 'Deep R' }, { id: 'swing', name: 'Swing' }] },
    blockSkips: [{ date: '2026-10-07', blockId: 'deep' }],
  });
  const m = mergePayloads(local, remote);
  assert.deepEqual(m.yearRhythm.dayBlocks.map(b => b.name), ['Deep L', 'Swing']);
  assert.deepEqual(m.yearRhythm.cycles, [2]);
  assert.equal(m.blockSkips.length, 1);
});

test('old tombstones are pruned', () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  const kept = pruneTombstones([
    { c: 'tasks', id: 'x', at: '2026-01-01T00:00:00Z' },
    { c: 'tasks', id: 'y', at: '2026-09-01T00:00:00Z' },
  ], now);
  assert.deepEqual(kept.map(t => t.id), ['y']);
});

test('first save without a baseline stamps everything as new', async () => {
  const fresh = await import('../js/merge.js?fresh=1');
  state.tombstones = [];
  const p = payload({ tasks: [{ id: 'n', name: 'New on a fresh device' }] });
  assert.equal(fresh.stampChanges(p, '2026-10-06T12:00:00.000Z'), true);
  assert.equal(p.tasks[0].updatedAt, '2026-10-06T12:00:00.000Z');
  assert.deepEqual(state.tombstones, [], 'no baseline must not invent deletions');
});

test('legacy object-shaped groups survive a merge without duplicates', () => {
  const legacy = { 'Group 1': ['a', 'b'] };
  const local = payload({ groups: legacy });
  const remote = payload({ groups: legacy });
  const m = mergePayloads(local, remote);
  assert.equal(m.groups.length, 1);
  assert.equal(m.groups[0].name, 'Group 1');
  assert.deepEqual(m.groups[0].taskIds, ['a', 'b']);
  assert.equal(mergePayloads(payload(), remote).groups.length, 1, 'remote legacy groups are kept');
});
