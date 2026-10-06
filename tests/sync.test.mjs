import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser stand-ins so the real sync/storage modules run in Node.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
globalThis.document = { getElementById: () => null };

const { state, normalizeTask, seedYearRhythm } = await import('../js/state.js');
const { save, getPersistPayload, applyPersistPayload } = await import('../js/storage.js');
const { ghPush, ghConnected } = await import('../js/sync.js');
const { deps } = await import('../js/deps.js');
const { isDirty, setDirty } = await import('../js/merge.js');

const enc = s => Buffer.from(s, 'utf8').toString('base64');
const dec = s => Buffer.from(s, 'base64').toString('utf8');

/** In-memory GitHub contents API. `onPut` runs before the PUT is answered. */
function fakeGithub(initial, onPut) {
  const remote = { sha: 'sha1', payload: initial, puts: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    const res = (status, body) => new Response(JSON.stringify(body), { status });
    if ((opts.method || 'GET') === 'GET') {
      return res(200, { sha: remote.sha, content: enc(JSON.stringify(remote.payload)) });
    }
    if (onPut) await onPut(remote.puts);
    const body = JSON.parse(opts.body);
    if (body.sha !== remote.sha) return res(409, {});
    remote.payload = JSON.parse(dec(body.content));
    remote.sha = 'sha' + (2 + remote.puts++);
    return res(200, { content: { sha: remote.sha } });
  };
  return remote;
}

function connect() {
  store.set('tb-gh-token', 'x'); store.set('tb-gh-owner', 'me'); store.set('tb-gh-repo', 'data');
  deps.ghConnected = ghConnected;
  deps.ghPush = ghPush;
  state.syncGate = 'ready';
}

test('edits made while a push is in flight stay dirty and get pushed next', async () => {
  connect();
  const first = { version: 11, tasks: [normalizeTask({ id: 'a', name: 'A' })], yearRhythm: seedYearRhythm('2026-01-05') };
  applyPersistPayload(first);
  state.fileSha = 'sha1';
  setDirty(false);

  state.tasks[0].name = 'A edited before push';
  save();
  clearTimeout(state.ghPushTimer);
  assert.equal(isDirty(), true);

  // The user keeps typing while the first PUT is still in flight.
  const remote = fakeGithub(first, async n => {
    if (n === 0) { state.tasks[0].name = 'A edited during push'; save(); clearTimeout(state.ghPushTimer); }
  });
  await ghPush({ quiet: true });

  assert.equal(remote.payload.tasks[0].name, 'A edited before push', 'first push carried the old edit');
  assert.equal(isDirty(), true, 'newer edit is not on GitHub, so the flag must stay set');

  // The follow-up push that ghPush scheduled.
  await new Promise(r => setTimeout(r, 20));
  assert.equal(remote.payload.tasks[0].name, 'A edited during push');
  assert.equal(isDirty(), false);
  clearTimeout(state.ghPushTimer);
});

test('a startup roll-forward counts as a local edit', () => {
  connect();
  setDirty(false);
  const past = new Date(); past.setDate(past.getDate() - 14);
  const ymd = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
  applyPersistPayload({
    version: 11,
    tasks: [{ id: 'late', name: 'Overdue', date: ymd, start: '10:00' }],
    yearRhythm: seedYearRhythm('2026-01-05'),
  });
  const t = getPersistPayload().tasks[0];
  assert.deepEqual(t.missed, [ymd], 'missed date recorded');
  assert.ok(t.date > ymd, 'moved forward');
  assert.ok(t.updatedAt, 'stamped, so a merge keeps it');
  assert.equal(isDirty(), true, 'dirty, so the next pull merges instead of replacing');
});
