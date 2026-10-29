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
import { registerActions } from './actions.js';
import { ensureProjectsMigrated, mergeProjects } from './projects.js';
import { applyGroupSchedule, ensureGroups } from './groups.js';
import {
  ensureSkills, addSkillFromForm, addSkillFromFormSubmit, renderSkillsPanel, onTaskDoneMaybeLearn, removeSkill,
  ensureWeeklyLearnBlock,
} from './skills.js';
import {
  renderSomedayPanel, somedayDelegate, somedayConvert, somedayDelete, somedayDefer,
  renderSlippedPanel, slippedToSomeday,
} from './someday.js';
import { state as appState } from './state.js';
import { deriveActivityRules } from './blocks.js';
import { markClean } from './merge.js';
import { getPersistPayload } from './storage.js';
import { startNextUpTicker } from './next-up.js';
import * as agentUi from './agent-ui.js';
import * as defer from './defer.js';
import { planRecovery, skipRecovery } from './recovery.js';
import * as outcome from './outcome.js';
import { openDelegatedPanel, setBoardView } from './needs-you.js';

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

// Late-bound hooks that state.js, dashboard.js and dashboard-edit.js look up on window to avoid import
// cycles. They are called from code, never from markup.
window.deps = deps;
window.deriveActivityRules = deriveActivityRules;
window.onTaskDoneMaybeOutcome = t => { if (outcome.needsOutcome(t)) outcome.openOutcome(t.id); };
window.onTaskDoneMaybeLearn = onTaskDoneMaybeLearn;
window.renderSomedayPanel = renderSomedayPanel;

// Everything markup can ask for (data-click="name" and friends, see actions.js).
registerActions(plan, year, dashboard, agentUi, defer, outcome, {
  openDelegatedPanel, setBoardView, planRecovery, skipRecovery,
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
  addSkillFromFormSubmit,
  removeSkill,
  renderSkillsPanel,
  somedayDelegate,
  somedayConvert,
  somedayDelete,
  somedayDefer,
  renderSlippedPanel,
  slippedToSomeday,
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
// Defaults created above (seed rhythm, default blocks, built-in projects) are not edits: on a new
// device they must never be stamped, or a merge could put them over the real year rhythm.
markClean(getPersistPayload());
ensureTimerTick();
startNextUpTicker();
agentUi.loadCachedAgentResults();
agentUi.startAgentResultsTicker();
switchPhase('plan');
refreshSyncForm();

// Pull remote BEFORE learn-block seeding / auto-push, so phone and desktop share one source of truth.
bootSync().finally(() => {
  (appState.skills || []).filter(s => s.quadrant === 'schedule').forEach(ensureWeeklyLearnBlock);
  agentUi.refreshAgentResults(true);
});
