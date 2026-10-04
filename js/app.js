import { state, addCustomProject, ensureTimerTick, setHideDone, toggleTaskDone, startTaskTimer, pauseTaskTimer, stopTaskTimer } from './state.js';
import { save, load } from './storage.js';
import {
  ghConnect, ghPull, ghPush, ghDisconnect, toggleSyncPanel, refreshSyncForm, ghConnected, bindLogoSync, bootSync,
} from './sync.js';
import * as plan from './plan.js';
import * as year from './year.js';
import * as dashboard from './dashboard.js';
import { render, switchPhase, clearAll } from './ui.js';
import { deps } from './deps.js';
import { ensureProjectsMigrated, mergeProjects } from './projects.js';
import { applyGroupSchedule, ensureGroups } from './groups.js';
import {
  ensureSkills, addSkillFromForm, renderSkillsPanel, onTaskDoneMaybeLearn,
  ensureWeeklyLearnBlock,
} from './skills.js';
import {
  renderSomedayPanel, somedayDelegate, somedayConvert, somedayDelete, somedayDefer,
} from './someday.js';
import { state as appState } from './state.js';
import { deriveActivityRules } from './blocks.js';

deps.save = save;
deps.render = render;
deps.switchPhase = switchPhase;
deps.renderDashboard = dashboard.renderDashboard;
deps.renderYear = year.renderYear;
deps.ensureYearWeekMonday = year.ensureYearWeekMonday;
deps.renderDayCalendar = dashboard.renderDayCalendar;
deps.renderProjectBoard = dashboard.renderProjectBoard;
deps.ghConnected = ghConnected;
deps.ghPush = ghPush;

window.deps = deps;
window.deriveActivityRules = deriveActivityRules;

Object.assign(window, plan, year, dashboard, {
  switchPhase,
  clearAll,
  render,
  addCustomProject,
  addDomainFromForm: dashboard.addDomainFromForm,
  toggleDomainCol: dashboard.toggleDomainCol,
  expandAllDomains: dashboard.expandAllDomains,
  collapseAllDomains: dashboard.collapseAllDomains,
  setHideDone,
  toggleTaskDone,
  startTaskTimer,
  pauseTaskTimer,
  stopTaskTimer,
  ghConnect,
  ghPull,
  ghPush: () => { clearTimeout(state.ghPushTimer); return ghPush({ quiet: false }); },
  ghDisconnect,
  toggleSyncPanel,
  addSkillFromForm,
  renderSkillsPanel,
  onTaskDoneMaybeLearn,
  renderSomedayPanel,
  somedayDelegate,
  somedayConvert,
  somedayDelete,
  somedayDefer,
  applyGroupSchedule: (id) => { applyGroupSchedule(id); save(); plan.renderPlan(); },
  mergeProjects,
  save,
  // legacy phase names
  renderTriage: plan.renderPlan,
  renderOrganize: plan.renderPlan,
  renderSchedule: () => {},
});

bindLogoSync();

load();
ensureProjectsMigrated();
ensureGroups();
ensureSkills();
year.ensureYearWeekMonday();
ensureTimerTick();
switchPhase('plan');
refreshSyncForm();

// Pull remote BEFORE learn-block seeding / auto-push, so phone and desktop share one source of truth.
bootSync().finally(() => {
  (appState.skills || []).filter(s => s.quadrant === 'schedule').forEach(ensureWeeklyLearnBlock);
});
