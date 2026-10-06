import { state } from './state.js';
import { getPersistPayload, applyPersistPayload } from './storage.js';
import { deps } from './deps.js';
import { mergePayloads, isDirty, setDirty } from './merge.js';

/* ---------- GitHub data.json sync (bar-shifts pattern) ---------- */
// BACKLOG: Supabase auth + per-user private sync when opening to other users.
export const DATA_PATH = 'data.json';
export const LS_GH_TOKEN = 'tb-gh-token';
export const LS_GH_OWNER = 'tb-gh-owner';
export const LS_GH_REPO = 'tb-gh-repo';

export function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
export function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

// Personal data lives only in the private data repo — never the public Pages app repo.
export const DEFAULT_DATA_OWNER = 'Rumi-Shamz';
export const DEFAULT_DATA_REPO = 'task-brain-data';
export const PUBLIC_APP_REPO = 'task-brain';
export function guessRepo() {
  return { owner: DEFAULT_DATA_OWNER, repo: DEFAULT_DATA_REPO };
}
/** If a device still points at the public Pages repo, rewrite to the private data repo. */
export function migrateStoredRepo() {
  const repo = (lsGet(LS_GH_REPO) || '').trim();
  if (repo.toLowerCase() === PUBLIC_APP_REPO) {
    lsSet(LS_GH_REPO, DEFAULT_DATA_REPO);
  }
  const owner = (lsGet(LS_GH_OWNER) || '').trim();
  if (owner && owner.toLowerCase() === DEFAULT_DATA_OWNER.toLowerCase() && owner !== DEFAULT_DATA_OWNER) {
    lsSet(LS_GH_OWNER, DEFAULT_DATA_OWNER);
  }
}
export function isPublicAppRepo(owner, repo) {
  return String(repo || '').toLowerCase() === PUBLIC_APP_REPO;
}
export function ghCfg() {
  migrateStoredRepo();
  const g = guessRepo();
  return { token: lsGet(LS_GH_TOKEN), owner: lsGet(LS_GH_OWNER) || g.owner, repo: lsGet(LS_GH_REPO) || g.repo };
}
export function ghConnected() {
  const c = ghCfg();
  return !!(c.token && c.owner && c.repo);
}

export function canAutoPush() {
  return ghConnected() && state.syncGate === 'ready' && !state.ghSaving;
}

function formatSyncTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

export function refreshSyncStatus() {
  if (!ghConnected()) {
    state.syncGate = 'local';
    setSyncStatus('Local only');
    return;
  }
  if (state.syncGate === 'boot') {
    setSyncStatus('Pulling…');
    return;
  }
  if (state.syncGate === 'blocked') {
    setSyncStatus('Not synced — Pull required');
    return;
  }
  const when = formatSyncTime(state.lastSyncAt);
  setSyncStatus(when ? `Synced · ${when}` : 'Synced · data.json');
}

export function setSyncMsg(text, kind) {
  const el = document.getElementById('sync-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'sync-msg' + (kind ? ' ' + kind : '');
}
export function setSyncStatus(text) {
  const el = document.getElementById('sync-status');
  if (el) el.textContent = text || '';
}
export function refreshSyncForm() {
  const c = ghCfg();
  const tok = document.getElementById('su-token');
  const own = document.getElementById('su-owner');
  const rep = document.getElementById('su-repo');
  if (tok && !tok.value) tok.value = c.token;
  if (own) own.value = c.owner;
  if (rep) rep.value = c.repo;
  refreshSyncStatus();
}
export function toggleSyncPanel(force) {
  const panel = document.getElementById('sync-panel');
  if (!panel) return;
  const open = force === undefined ? panel.style.display === 'none' : !!force;
  panel.style.display = open ? 'block' : 'none';
  if (open) refreshSyncForm();
}
export function b64enc(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
export function b64dec(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function ghApi(c, method, body, accept) {
  return fetch(
    'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' +
      encodeURIComponent(c.repo) + '/contents/' + DATA_PATH,
    {
      method,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + c.token, Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
}
export function pullErrorMessage(e) {
  if (typeof e === 'string') return e;
  if (e && e.message) return 'Pull failed: ' + e.message;
  return 'Pull failed. Use private repo task-brain-data, then Connect & pull.';
}

function applyPayloadAndRender(payload) {
  applyPersistPayload(payload);
  try { localStorage.setItem('dayplanner_v3', JSON.stringify(getPersistPayload())); } catch (e) {}
  state.lastSyncAt = payload.updatedAt || new Date().toISOString();
  try { if (typeof deps.render === 'function') deps.render(); } catch (e) { console.warn('render after pull', e); }
  try { if (typeof deps.renderDashboard === 'function') deps.renderDashboard(); } catch (e) { console.warn('dashboard after pull', e); }
  try { if (typeof deps.renderYear === 'function') deps.renderYear(); } catch (e) { console.warn('year after pull', e); }
}

/** GET data.json → { sha, payload }. sha is null when the file does not exist yet. */
function fetchRemote(c) {
  return ghApi(c, 'GET').then(r => {
    if (r.status === 404) return { sha: null, payload: null };
    if (!r.ok) throw r.status;
    return r.json().then(j => {
      if (j.content) return { sha: j.sha, payload: JSON.parse(b64dec(j.content)) };
      // Files over 1 MB come without inline content; fetch the raw body instead.
      return ghApi(c, 'GET', null, 'application/vnd.github.raw+json')
        .then(raw => { if (!raw.ok) throw raw.status; return raw.json(); })
        .then(payload => ({ sha: j.sha, payload }));
    });
  });
}

export function ghPull() {
  const c = ghCfg();
  if (!c.token || !c.owner || !c.repo) {
    setSyncMsg('Connect with a token first.', 'err');
    state.syncGate = 'local';
    refreshSyncStatus();
    return Promise.resolve({ ok: false, reason: 'no-creds' });
  }
  if (isPublicAppRepo(c.owner, c.repo)) {
    lsSet(LS_GH_REPO, DEFAULT_DATA_REPO);
    setSyncMsg('Repo was the public Pages app. Switched to task-brain-data — Connect & pull again.', 'err');
    refreshSyncForm();
    return Promise.resolve({ ok: false, reason: 'public-repo' });
  }
  setSyncMsg('Pulling…');
  if (state.syncGate === 'boot') setSyncStatus('Pulling…');
  return fetchRemote(c).then(({ sha, payload }) => {
    if (!sha) {
      // No remote file yet — safe to push local as the first copy
      state.fileSha = null;
      state.syncGate = 'ready';
      state.lastSyncAt = null;
      setSyncMsg('No data.json yet — Push save to create it from this device.', 'ok');
      refreshSyncStatus();
      return { ok: true, empty: true };
    }
    const merge = isDirty();
    applyPayloadAndRender(merge ? mergePayloads(getPersistPayload(), payload) : payload);
    state.fileSha = sha;
    state.syncGate = 'ready';
    refreshSyncStatus();
    if (!merge) {
      setSyncMsg('Pulled latest data.json.', 'ok');
      return { ok: true, empty: false };
    }
    // Edits made here before the pull are merged in; send the result back.
    setSyncMsg('Merged edits from this device with data.json — saving…', 'ok');
    return ghPush({ quiet: true }).then(() => {
      setSyncMsg(isDirty()
        ? 'Merged edits from this device, but saving failed — Push save to retry.'
        : 'Merged edits from this device with data.json and saved.', isDirty() ? 'err' : 'ok');
      return { ok: true, empty: false, merged: true };
    });
  }).catch(e => {
    state.syncGate = 'blocked';
    setSyncMsg(pullErrorMessage(typeof e === 'number' ? 'GitHub error ' + e : e), 'err');
    refreshSyncStatus();
    return { ok: false, reason: e };
  });
}

export function ghPush(opts, attempt = 0) {
  const quiet = opts && opts.quiet;
  const c = ghCfg();
  if (!c.token || !c.owner || !c.repo) {
    if (!quiet) setSyncMsg('Connect with a token first.', 'err');
    return Promise.resolve();
  }
  if (isPublicAppRepo(c.owner, c.repo)) {
    lsSet(LS_GH_REPO, DEFAULT_DATA_REPO);
    if (!quiet) setSyncMsg('Refusing to save into the public Pages repo. Switched to task-brain-data.', 'err');
    refreshSyncForm();
    return Promise.resolve();
  }
  // Never auto-push until a successful pull (or confirmed empty remote)
  if (quiet && state.syncGate !== 'ready') {
    return Promise.resolve();
  }
  if (state.ghSaving) return Promise.resolve();
  state.ghSaving = true;
  if (!quiet) setSyncMsg('Saving…');
  let merged = false;
  let editGenAtSend = 0;
  return fetchRemote(c).then(({ sha, payload }) => {
    // Someone else saved since our last pull: merge record by record instead of overwriting either side.
    if (sha && sha !== state.fileSha) {
      applyPayloadAndRender(mergePayloads(getPersistPayload(), payload));
      merged = true;
    }
    editGenAtSend = state.editGen || 0;
    const body = JSON.stringify(getPersistPayload(), null, 2) + '\n';
    return ghApi(c, 'PUT', { message: 'Update Task Brain data.json', content: b64enc(body), sha: sha || undefined });
  }).then(r => {
    if (!r.ok) throw r.status;
    return r.json();
  }).then(j => {
    state.fileSha = j.content && j.content.sha;
    state.ghSaving = false;
    state.syncGate = 'ready';
    state.lastSyncAt = new Date().toISOString();
    // Edits made while this request was in flight are not in the file: stay dirty and send them next.
    if ((state.editGen || 0) === editGenAtSend) setDirty(false);
    else { clearTimeout(state.ghPushTimer); state.ghPushTimer = setTimeout(() => ghPush({ quiet: true }), 0); }
    if (merged) setSyncMsg('Merged changes from another device and saved.', 'ok');
    else if (!quiet) setSyncMsg('Saved to GitHub.', 'ok');
    refreshSyncStatus();
  }).catch(e => {
    state.ghSaving = false;
    // 409/422: another device saved between our GET and PUT. Merge again once.
    if ((e === 409 || e === 422) && attempt < 2) return ghPush(opts, attempt + 1);
    if (quiet) return;
    if (e === 401) setSyncMsg('Token rejected. Disconnect and reconnect with a fresh PAT.', 'err');
    else if (e === 403 || e === 404) setSyncMsg('Token needs Contents: Read and write on this repo.', 'err');
    else if (e === 409) setSyncMsg('Save clash. Pull, then Push again.', 'err');
    else setSyncMsg('Could not save' + (typeof e === 'number' ? ' (error ' + e + ')' : '') + '.', 'err');
  });
}

export function ghConnect() {
  const t = (document.getElementById('su-token') || {}).value.trim();
  let o = (document.getElementById('su-owner') || {}).value.trim();
  let r = (document.getElementById('su-repo') || {}).value.trim();
  if (!t || !o || !r) { setSyncMsg('Fill token, owner, and repo.', 'err'); return; }
  if (isPublicAppRepo(o, r)) {
    r = DEFAULT_DATA_REPO;
    const rep = document.getElementById('su-repo');
    if (rep) rep.value = r;
    setSyncMsg('Use private repo task-brain-data (not the public Pages app). Corrected — connecting…');
  }
  if (o.toLowerCase() === DEFAULT_DATA_OWNER.toLowerCase()) o = DEFAULT_DATA_OWNER;
  lsSet(LS_GH_TOKEN, t); lsSet(LS_GH_OWNER, o); lsSet(LS_GH_REPO, r);
  state.syncGate = 'boot';
  state.fileSha = null;
  setSyncMsg('Connected. Pulling…');
  refreshSyncStatus();
  ghPull().then(res => {
    if (res && res.ok && res.empty) ghPush({ quiet: false });
  });
}
export function ghDisconnect() {
  lsDel(LS_GH_TOKEN); lsDel(LS_GH_OWNER); lsDel(LS_GH_REPO);
  state.fileSha = null;
  state.syncGate = 'local';
  state.lastSyncAt = null;
  setSyncMsg('Disconnected. Local-only mode.', 'ok');
  refreshSyncStatus();
  const tok = document.getElementById('su-token');
  if (tok) tok.value = '';
}

/** Startup: pull remote before any auto-push can run. */
export function bootSync() {
  if (!ghConnected()) {
    state.syncGate = 'local';
    refreshSyncStatus();
    return Promise.resolve({ ok: false, local: true });
  }
  state.syncGate = 'boot';
  refreshSyncStatus();
  return ghPull();
}

export function bindLogoSync() {
  const logo = document.getElementById('app-logo');
  if (!logo) return;
  logo.addEventListener('click', () => toggleSyncPanel());
}
