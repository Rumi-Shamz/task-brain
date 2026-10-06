/** Per-record change stamps, tombstones, and two-device merge of data.json payloads. */
import { state } from './state.js';
import { normalizeGroups } from './groups.js';

const TOMBSTONE_DAYS = 90;
const LS_DIRTY = 'tb-dirty';

/** Collections merged record by record. `path` is read from the persisted payload. */
export const COLLECTIONS = [
  { name: 'tasks', path: ['tasks'] },
  { name: 'groups', path: ['groups'] },
  { name: 'projects', path: ['projects'] },
  { name: 'skills', path: ['skills'] },
  { name: 'customProjects', path: ['customProjects'] },
  { name: 'customDomains', path: ['customDomains'] },
  { name: 'activityRules', path: ['activityRules'] },
  { name: 'yearHourLogs', path: ['yearHourLogs'] },
  { name: 'dayBlocks', path: ['yearRhythm', 'dayBlocks'] },
  { name: 'blockSkips', path: ['blockSkips'], key: s => `${ s.date }|${ s.blockId }` },
];

/** Payload fields outside the collections. Last writer wins as one unit. */
const SETTINGS_KEYS = ['groupCounter', 'collapsedDomains', 'yearRhythm'];

let snapshot = null;

function keyOf(col, item) {
  if (!item || typeof item !== 'object') return null;
  if (col.key) return col.key(item);
  return item.id != null ? String(item.id) : null;
}

function getPath(obj, path) {
  return path.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!o[path[i]] || typeof o[path[i]] !== 'object') o[path[i]] = {};
    o = o[path[i]];
  }
  o[path[path.length - 1]] = value;
}

function bodyJson(item) {
  const { updatedAt, ...rest } = item;
  return JSON.stringify(rest);
}

function settingsJson(payload) {
  const out = {};
  SETTINGS_KEYS.forEach(k => { out[k] = payload[k]; });
  if (out.yearRhythm) {
    const { dayBlocks, hourLogs, ...rest } = out.yearRhythm;
    out.yearRhythm = rest;
  }
  return JSON.stringify(out);
}

function snapshotOf(payload) {
  const cols = {};
  COLLECTIONS.forEach(col => {
    const map = new Map();
    (getPath(payload, col.path) || []).forEach(item => {
      const k = keyOf(col, item);
      if (k != null) map.set(k, bodyJson(item));
    });
    cols[col.name] = map;
  });
  return { cols, settings: settingsJson(payload) };
}

/** Remember the current state as unchanged (after load, pull, or merge). */
export function markClean(payload) {
  snapshot = snapshotOf(payload);
}

/**
 * Stamp `updatedAt` on records that changed since the last snapshot and add
 * tombstones for records that disappeared. Mutates live state through the payload's references.
 */
export function stampChanges(payload, now = new Date().toISOString()) {
  // No baseline yet (first run without saved data): every record counts as new.
  if (!snapshot) snapshot = { cols: {}, settings: null };
  let changed = false;
  if (!Array.isArray(state.tombstones)) state.tombstones = [];
  COLLECTIONS.forEach(col => {
    const prev = snapshot.cols[col.name] || new Map();
    const seen = new Set();
    (getPath(payload, col.path) || []).forEach(item => {
      const k = keyOf(col, item);
      if (k == null) return;
      seen.add(k);
      if (prev.get(k) !== bodyJson(item)) {
        item.updatedAt = now;
        changed = true;
      }
    });
    prev.forEach((_, k) => {
      if (seen.has(k)) return;
      state.tombstones = state.tombstones.filter(t => !(t.c === col.name && t.id === k));
      state.tombstones.push({ c: col.name, id: k, at: now });
      changed = true;
    });
  });
  if (settingsJson(payload) !== snapshot.settings) {
    state.settingsUpdatedAt = now;
    changed = true;
  }
  markClean(payload);
  return changed;
}

export function pruneTombstones(list, now = Date.now()) {
  const cutoff = now - TOMBSTONE_DAYS * 86400000;
  return (Array.isArray(list) ? list : []).filter(t => t && t.c && t.id != null && Date.parse(t.at) >= cutoff);
}

function stamp(item) {
  return (item && item.updatedAt) || '';
}

function mergeCollection(col, localList, remoteList, tombs) {
  const local = Array.isArray(localList) ? localList : [];
  const remote = Array.isArray(remoteList) ? remoteList : [];
  const remoteByKey = new Map();
  remote.forEach(item => { const k = keyOf(col, item); if (k != null) remoteByKey.set(k, item); });
  const localKeys = new Set();
  const dead = (k, item) => {
    const t = tombs.get(col.name + '\u0000' + k);
    return !!t && t >= stamp(item);
  };
  const out = [];
  local.forEach(item => {
    const k = keyOf(col, item);
    if (k == null) return;
    localKeys.add(k);
    const other = remoteByKey.get(k);
    // Ties go to the remote copy: it is the one other devices already have.
    const pick = !other ? item : stamp(item) > stamp(other) ? item : other;
    if (!dead(k, pick)) out.push(pick);
  });
  remote.forEach(item => {
    const k = keyOf(col, item);
    if (k == null || localKeys.has(k)) return;
    if (!dead(k, item)) out.push(item);
  });
  return out;
}

/** Merge two persisted payloads record by record. Neither input is mutated. */
export function mergePayloads(local, remote) {
  const l = JSON.parse(JSON.stringify(local || {}));
  const r = JSON.parse(JSON.stringify(remote || {}));
  // Older files store groups as { name: [taskIds] }; merge only understands arrays.
  l.groups = normalizeGroups(l.groups);
  r.groups = normalizeGroups(r.groups);
  const tombList = pruneTombstones([...(l.tombstones || []), ...(r.tombstones || [])]);
  const tombs = new Map();
  tombList.forEach(t => {
    const k = t.c + '\u0000' + t.id;
    if (!tombs.has(k) || tombs.get(k) < t.at) tombs.set(k, t.at);
  });
  const settingsFromLocal = (l.settingsUpdatedAt || '') > (r.settingsUpdatedAt || '');
  const base = settingsFromLocal ? l : r;
  const out = { ...r };
  SETTINGS_KEYS.forEach(k => { out[k] = base[k]; });
  out.yearRhythm = { ...(base.yearRhythm || {}) };
  out.groupCounter = Math.max(Number(l.groupCounter) || 0, Number(r.groupCounter) || 0);
  out.settingsUpdatedAt = base.settingsUpdatedAt || null;
  COLLECTIONS.forEach(col => {
    setPath(out, col.path, mergeCollection(col, getPath(l, col.path), getPath(r, col.path), tombs));
  });
  out.yearRhythm.hourLogs = out.yearHourLogs;
  out.tombstones = [...tombs.entries()].map(([k, at]) => {
    const [c, id] = k.split('\u0000');
    return { c, id, at };
  });
  out.version = Math.max(Number(l.version) || 0, Number(r.version) || 0);
  out.updatedAt = new Date().toISOString();
  return out;
}

/** Local edits not yet confirmed on GitHub survive a reload in this flag. */
export function isDirty() {
  try { return localStorage.getItem(LS_DIRTY) === '1'; } catch (e) { return false; }
}
export function setDirty(on) {
  try {
    if (on) localStorage.setItem(LS_DIRTY, '1');
    else localStorage.removeItem(LS_DIRTY);
  } catch (e) {}
}
