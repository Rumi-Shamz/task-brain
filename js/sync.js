import { state } from './state.js';
import { getPersistPayload, applyPersistPayload } from './storage.js';
import { deps } from './deps.js';

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
  setSyncStatus(ghConnected() ? 'Synced · data.json' : 'Local only');
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
  const bin = atob(String(b64 || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export function ghApi(c, method, body) {
  return fetch(
    'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' +
      encodeURIComponent(c.repo) + '/contents/' + DATA_PATH,
    {
      method,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    }
  );
}
export function pullErrorMessage(e) {
  if (typeof e === 'string') return e;
  if (e && e.message) return 'Pull failed: ' + e.message;
  return 'Pull failed. Use private repo task-brain-data, then Connect & pull.';
}
export function ghPull() {
  const c = ghCfg();
  if (!c.token || !c.owner || !c.repo) {
    setSyncMsg('Connect with a token first.', 'err');
    return Promise.resolve();
  }
  if (isPublicAppRepo(c.owner, c.repo)) {
    lsSet(LS_GH_REPO, DEFAULT_DATA_REPO);
    setSyncMsg('Repo was the public Pages app. Switched to task-brain-data — Connect & pull again.', 'err');
    refreshSyncForm();
    return Promise.resolve();
  }
  setSyncMsg('Pulling…');
  return ghApi(c, 'GET').then(r => {
    if (r.status === 404) throw 'No data.json in repo yet — Push save to create it.';
    if (!r.ok) throw 'GitHub error ' + r.status;
    return r.json();
  }).then(j => {
    state.fileSha = j.sha;
    applyPersistPayload(JSON.parse(b64dec(j.content)));
    try { localStorage.setItem('dayplanner_v3', JSON.stringify(getPersistPayload())); } catch (e) {}
    deps.render();
    deps.renderDashboard();
    deps.renderYear();
    setSyncMsg('Pulled latest data.json.', 'ok');
    setSyncStatus('Synced · data.json');
  }).catch(e => { setSyncMsg(pullErrorMessage(e), 'err'); });
}
export function ghPush(opts) {
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
  if (state.ghSaving) return Promise.resolve();
  state.ghSaving = true;
  if (!quiet) setSyncMsg('Saving…');
  const body = JSON.stringify(getPersistPayload(), null, 2) + '\n';
  function put(sha) {
    return ghApi(c, 'PUT', { message: 'Update Task Brain data.json', content: b64enc(body), sha: sha || undefined });
  }
  return ghApi(c, 'GET').then(r => {
    if (r.status === 404) return { sha: null };
    if (!r.ok) throw r.status;
    return r.json();
  }).then(j => {
    if (state.fileSha && j.sha && j.sha !== state.fileSha) throw 'stale';
    return put(j.sha);
  }).then(r => {
    if (!r.ok) throw r.status;
    return r.json();
  }).then(j => {
    state.fileSha = j.content && j.content.sha;
    state.ghSaving = false;
    if (!quiet) setSyncMsg('Saved to GitHub. Sites usually update within a few minutes.', 'ok');
    setSyncStatus('Synced · data.json');
  }).catch(e => {
    state.ghSaving = false;
    if (quiet) return;
    if (e === 'stale') setSyncMsg('Newer version exists on GitHub. Pull first, then Push.', 'err');
    else if (e === 401) setSyncMsg('Token rejected. Disconnect and reconnect with a fresh PAT.', 'err');
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
  setSyncMsg('Connected. Pulling…');
  ghPull().then(() => {
    if (!state.fileSha) ghPush();
  });
}
export function ghDisconnect() {
  lsDel(LS_GH_TOKEN); lsDel(LS_GH_OWNER); lsDel(LS_GH_REPO);
  state.fileSha = null;
  setSyncMsg('Disconnected. Local-only mode.', 'ok');
  setSyncStatus('Local only');
  const tok = document.getElementById('su-token');
  if (tok) tok.value = '';
}


export function bindLogoSync() {
  let taps = 0, last = 0;
  document.addEventListener('click', e => {
    const logo = e.target.closest('#app-logo');
    if (!logo) return;
    const now = Date.now();
    taps = (now - last < 550) ? taps + 1 : 1;
    last = now;
    if (taps >= 3) { taps = 0; toggleSyncPanel(); }
  });
}
