import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { getElementById: () => null };
const { state } = await import('../js/state.js');
const { importHealth } = await import('../js/import-plan.js');

test('import accuracy survives an import record without taskIds', () => {
  state.tasks = [];
  state.imports = [
    { id: 'x', from: 'w1', at: '2026-10-05T00:00:00Z' },
    { id: 'y', from: 'w2', at: '2026-10-06T00:00:00Z', taskIds: 'oops' },
  ];
  assert.deepEqual(importHealth().map(r => [r.count, r.fixed, r.deleted]), [[0, 0, 0], [0, 0, 0]]);
});
