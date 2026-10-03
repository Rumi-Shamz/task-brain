import { state } from './state.js';
import { deps } from './deps.js';
import { renderTriage } from './triage.js';
import { renderOrganize } from './organize.js';
import { renderSchedule } from './schedule.js';
import { renderYear, ensureYearWeekMonday } from './year.js';
import { renderDashboard } from './dashboard.js';

export function render() {

  renderTriage();
  renderOrganize();
  document.getElementById('triage-actions').style.display = state.tasks.length ? 'block' : 'none';
}

export function switchPhase(phase) {
  document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.phase-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('phase-' + phase).classList.add('active');
  const idx = { triage: 0, organize: 1, schedule: 2, year: 3, dashboard: 4 }[phase];
  document.querySelectorAll('.phase-tab')[idx].classList.add('active');
  document.body.classList.toggle('year-active', phase === 'year');
  document.body.classList.toggle('dashboard-active', phase === 'dashboard');
  if (phase === 'organize') renderOrganize();
  if (phase === 'schedule') renderSchedule();
  if (phase === 'year') { ensureYearWeekMonday();
    renderYear(); }
  if (phase === 'dashboard') renderDashboard();
}

export function clearAll() {
  if (!confirm('Clear all tasks and start fresh?')) return;
  state.tasks = []; state.groups = {}; state.groupCounter = 0; state.schedule = [];
  deps.save(); render(); deps.switchPhase('triage');
}

