import {
  state, normalizeTask, normalizeRhythm, normalizeHourLogs,
  normalizeCustomProjects, normalizeWorkSchedule, seedYearRhythm, rhythmWithHours,
} from './state.js';
import { ensureProjectsMigrated } from './projects.js';
import { normalizeGroups } from './groups.js';
import { normalizeDayBlocks, normalizeActivityRules, rollOpenTasksForward } from './blocks.js';
import { normalizeCustomDomains } from './domains.js';
import { deps } from './deps.js';
import { stampChanges, markClean, pruneTombstones, setDirty } from './merge.js';

export function save() {
  const changed = stampChanges(getPersistPayload());
  try { localStorage.setItem('dayplanner_v3', JSON.stringify(getPersistPayload())); } catch (e) {}
  if (changed) {
    // A push in flight compares this counter to know whether newer edits arrived while it ran.
    state.editGen = (state.editGen || 0) + 1;
    if (deps.ghConnected && deps.ghConnected()) setDirty(true);
  }
  // Only auto-push after a successful boot pull (or confirmed empty remote).
  // Prevents one device's localStorage from overwriting the shared data.json.
  if (deps.ghConnected && deps.ghConnected() && state.syncGate === 'ready') {
    clearTimeout(state.ghPushTimer);
    state.ghPushTimer = setTimeout(() => deps.ghPush({ quiet: true }), 1800);
  }
}

export function getPersistPayload() {
  return {
    version: 9,
    updatedAt: new Date().toISOString(),
    settingsUpdatedAt: state.settingsUpdatedAt || null,
    tombstones: state.tombstones || [],
    tasks: state.tasks,
    groups: state.groups,
    groupCounter: state.groupCounter,
    schedule: state.schedule,
    yearRhythm: rhythmWithHours(),
    yearHourLogs: state.yearHourLogs,
    customProjects: state.customProjects,
    projects: state.projects || [],
    skills: state.skills || [],
    customDomains: state.customDomains || [],
    collapsedDomains: state.collapsedDomains,
    activityRules: state.activityRules || [],
    blockSkips: state.blockSkips || [],
    imports: state.imports || [],
  };
}

export function applyPersistPayload(d) {
  if (!d || typeof d !== 'object') return;
  // v3 → v4: ensure status/reviewAt/domain on tasks (normalizeTask handles defaults)
  state.tasks = (d.tasks || []).map(normalizeTask);
  state.groups = normalizeGroups(d.groups);
  state.groupCounter = d.groupCounter || 0;
  state.planWizardIndex = d.planWizardIndex || 0;
  state.schedule = d.schedule || [];
  state.yearRhythm = normalizeRhythm(d.yearRhythm);
  state.yearHourLogs = normalizeHourLogs(
    d.yearHourLogs || (d.yearRhythm && d.yearRhythm.hourLogs) || []
  );
  state.customProjects = normalizeCustomProjects(d.customProjects);
  state.projects = Array.isArray(d.projects) ? d.projects : [];
  state.skills = Array.isArray(d.skills) ? d.skills : [];
  state.customDomains = normalizeCustomDomains(d.customDomains);
  state.collapsedDomains = Array.isArray(d.collapsedDomains) ? d.collapsedDomains : null;
  if (!state.yearRhythm) state.yearRhythm = seedYearRhythm();
  state.yearRhythm.workSchedule = normalizeWorkSchedule(state.yearRhythm.workSchedule);
  state.yearRhythm.dayBlocks = normalizeDayBlocks(state.yearRhythm.dayBlocks || d.dayBlocks);
  state.activityRules = normalizeActivityRules(d.activityRules);
  state.blockSkips = Array.isArray(d.blockSkips) ? d.blockSkips : [];
  state.imports = Array.isArray(d.imports) ? d.imports : [];
  // v8 → v9: per-record updatedAt + tombstones for merging two devices (absent = never stamped)
  state.tombstones = pruneTombstones(d.tombstones);
  state.settingsUpdatedAt = d.settingsUpdatedAt || null;
  ensureProjectsMigrated();
  // Baseline first, so the roll-forward below counts as a local edit: it gets stamped and pushed,
  // and a later pull merges it (with its missed dates) instead of replacing it.
  markClean(getPersistPayload());
  rollOpenTasksForward();
  if (stampChanges(getPersistPayload())) {
    state.editGen = (state.editGen || 0) + 1;
    if (deps.ghConnected && deps.ghConnected()) setDirty(true);
  }
}

export function load() {
  try {
    let d = JSON.parse(localStorage.getItem('dayplanner_v3') || 'null');
    if (!d) {
      const v2 = JSON.parse(localStorage.getItem('dayplanner_v2') || 'null');
      if (v2) d = v2;
    }
    if (d) applyPersistPayload(d);
    else { state.yearRhythm = seedYearRhythm();
      state.yearHourLogs = [];
      state.customProjects = []; }
  } catch (e) { state.yearRhythm = seedYearRhythm();
    state.yearHourLogs = [];
    state.customProjects = []; }
  if (!state.yearRhythm) state.yearRhythm = seedYearRhythm();
  state.yearRhythm.workSchedule = normalizeWorkSchedule(state.yearRhythm.workSchedule);
}

