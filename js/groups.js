/** Execution-batch groups (Plan board). */
import { state, uid } from './state.js';
import { nextOpenWeekday, placeInInterval } from './blocks.js';

const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const SLOT_INTERVAL = {
  morning: 'start', afternoon: 'mid', evening: 'late',
  start: 'start', mid: 'mid', late: 'late',
};

export function normalizeGroups(raw) {
  // Legacy: { "Group 1": [id, id] }
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    return Object.keys(raw).map(name => ({
      id: 'g-' + uid(),
      name,
      preferredDay: null,
      preferredStart: null,
      taskIds: Array.isArray(raw[name]) ? raw[name] : [],
    }));
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(g => ({
    id: g.id || ('g-' + uid()),
    name: String(g.name || 'Batch').trim() || 'Batch',
    preferredDay: g.preferredDay || null,
    preferredStart: g.preferredStart || null,
    taskIds: Array.isArray(g.taskIds) ? g.taskIds.slice() : [],
  }));
}

export function ensureGroups() {
  state.groups = normalizeGroups(state.groups);
  return state.groups;
}

export function createGroup({ name, preferredDay, preferredStart, taskIds }) {
  ensureGroups();
  state.groupCounter = (state.groupCounter || 0) + 1;
  const g = {
    id: 'g-' + uid(),
    name: (name || `Batch ${state.groupCounter}`).trim(),
    preferredDay: preferredDay || null,
    preferredStart: preferredStart || null,
    taskIds: Array.isArray(taskIds) ? taskIds.slice() : [],
  };
  state.groups.push(g);
  g.taskIds.forEach(id => {
    const t = state.tasks.find(x => x.id === id);
    if (t) t.group = g.id;
  });
  return g;
}

export function addTaskToGroup(groupId, taskId) {
  ensureGroups();
  const g = state.groups.find(x => x.id === groupId);
  const t = state.tasks.find(x => x.id === taskId);
  if (!g || !t) return;
  if (!g.taskIds.includes(taskId)) g.taskIds.push(taskId);
  t.group = groupId;
}

/** Apply batch window to grouped tasks unless blocking / earlier deadline exception. */
export function applyGroupSchedule(groupId) {
  ensureGroups();
  const g = state.groups.find(x => x.id === groupId);
  if (!g || !g.preferredDay) return;
  const dayKey = String(g.preferredDay).toLowerCase();
  const slotKey = String(g.preferredStart || 'afternoon').toLowerCase();
  const intervalId = SLOT_INTERVAL[slotKey];
  if (DAY_OFFSET[dayKey] == null || !intervalId) return;
  const date = nextOpenWeekday(new Date(), DAY_OFFSET[dayKey]);
  if (!date) return;
  g.taskIds.forEach(id => {
    const t = state.tasks.find(x => x.id === id);
    if (!t || t.done || t.status === 'someday') return;
    if (t.blocking) return;
    if (t.deadline && t.deadline < date) return;
    placeInInterval(t, date, intervalId);
  });
}

export function listGroups() {
  return ensureGroups();
}
