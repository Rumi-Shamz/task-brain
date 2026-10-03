import {
  state, normalizeTask, normalizeRhythm, normalizeHourLogs,
  normalizeCustomProjects, normalizeWorkSchedule, seedYearRhythm, rhythmWithHours,
} from './state.js';
import { ensureProjectsMigrated } from './projects.js';
import { normalizeGroups } from './groups.js';
import { normalizeCustomDomains } from './domains.js';
import { deps } from './deps.js';

export function save() {
  try { localStorage.setItem('dayplanner_v3', JSON.stringify(getPersistPayload())); } catch (e) {}
  // Only auto-push after a successful boot pull (or confirmed empty remote).
  // Prevents one device's localStorage from overwriting the shared data.json.
  if (deps.ghConnected && deps.ghConnected() && state.syncGate === 'ready') {
    clearTimeout(state.ghPushTimer);
    state.ghPushTimer = setTimeout(() => deps.ghPush({ quiet: true }), 1800);
  }
}

export function getPersistPayload() {
  return {
    version: 8,
    updatedAt: new Date().toISOString(),
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
  ensureProjectsMigrated();
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

