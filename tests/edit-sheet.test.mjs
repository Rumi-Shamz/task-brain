import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = { getElementById: () => null, addEventListener: () => {} };
const { state, normalizeTask } = await import('../js/state.js');
const { placementUnchanged, KEEP_TIME, intervalForTask } = await import('../js/blocks.js');
const { weekTaskBlocksHTML } = await import('../js/dashboard-drag.js');

const task = (extra) => normalizeTask({ id: 't', name: 'T', date: '2026-10-07', duration: 30, ...extra });

test('saving the edit sheet leaves a task where it is unless the day or window changed', () => {
  const inWindow = task({ start: '09:40', interval: 'start' });
  assert.equal(placementUnchanged(inWindow, '2026-10-07', intervalForTask(inWindow)), true, 'rename only');
  assert.equal(placementUnchanged(inWindow, '2026-10-08', 'start'), false, 'moved to another day');
  assert.equal(placementUnchanged(inWindow, '2026-10-07', 'late'), false, 'moved to another window');
  assert.equal(placementUnchanged(inWindow, '2026-10-07', ''), false, '"Leave open" unschedules');
  const outside = task({ start: '22:30' });           // outside Start/Mid/Late
  assert.equal(intervalForTask(outside), '');
  assert.equal(placementUnchanged(outside, '2026-10-07', KEEP_TIME), true, 'sheet shows "Keep 22:30"');
  assert.equal(placementUnchanged(outside, '2026-10-07', ''), false, 'explicit "Leave open" unschedules');
  assert.equal(placementUnchanged(task({}), '2026-10-07', ''), false, 'an unscheduled task has nothing to keep');
});

test('task ids are escaped in the Year week markup', () => {
  const evil = `a" onmouseover="alert(1)`;
  state.hideDone = false;
  state.tasks = [task({ id: evil, start: '10:00' })];
  const html = weekTaskBlocksHTML('2026-10-07');
  assert.ok(html.includes('data-task-id="a&quot; onmouseover=&quot;alert(1)"'), 'attribute value stays one value');
  assert.equal(/" onmouseover="/.test(html), false, 'no attribute injection');
  // JSON.stringify gives "a\" onmouseover=\"alert(1)"; esc() turns the quotes into &quot; so the attribute holds.
  assert.ok(html.includes('unscheduleTask(&quot;a\\&quot; onmouseover=\\&quot;alert(1)&quot;)'), 'handler argument is an escaped JSON string');
});
