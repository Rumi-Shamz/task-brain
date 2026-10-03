import { state, addCustomProject, ensureTimerTick, setHideDone, toggleTaskDone, startTaskTimer, pauseTaskTimer, stopTaskTimer } from './state.js';
import { save, load } from './storage.js';
import {
  ghConnect, ghPull, ghPush, ghDisconnect, toggleSyncPanel, refreshSyncForm, ghConnected, bindLogoSync
} from './sync.js';
import * as triage from './triage.js';
import * as organize from './organize.js';
import * as scheduleMod from './schedule.js';
import * as year from './year.js';
import * as dashboard from './dashboard.js';
import { render, switchPhase, clearAll } from './ui.js';
import { deps } from './deps.js';

deps.save = save;
deps.render = render;
deps.switchPhase = switchPhase;
deps.renderDashboard = dashboard.renderDashboard;
deps.renderYear = year.renderYear;
deps.ensureYearWeekMonday = year.ensureYearWeekMonday;
deps.renderOrganize = organize.renderOrganize;
deps.renderSchedule = scheduleMod.renderSchedule;
deps.renderDayCalendar = dashboard.renderDayCalendar;
deps.renderProjectBoard = dashboard.renderProjectBoard;
deps.ghConnected = ghConnected;
deps.ghPush = ghPush;

Object.assign(window, triage, organize, scheduleMod, year, dashboard, {
  switchPhase,
  clearAll,
  render,
  addCustomProject,
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
});

bindLogoSync();

load();
year.ensureYearWeekMonday();
ensureTimerTick();
render();
refreshSyncForm();
// Remote sync only via authenticated API against the private data repo.
if (ghConnected()) ghPull();
