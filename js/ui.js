import { state } from './state.js';
import { deps } from './deps.js';
import { renderPlan } from './plan.js';
import { renderYear, ensureYearWeekMonday } from './year.js';
import { renderDashboard } from './dashboard.js';
import { renderSkillsPanel } from './skills.js';
import { weekLnoStats } from './dashboard.js';

const PHASES = ['plan', 'dashboard', 'skills', 'year'];

export function render() {
  renderPlan();
}

export function switchPhase(phase) {
  // Legacy aliases
  if (phase === 'triage' || phase === 'organize' || phase === 'schedule') phase = 'plan';
  if (!PHASES.includes(phase)) phase = 'plan';

  document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.phase-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('phase-' + phase);
  if (panel) panel.classList.add('active');
  const idx = PHASES.indexOf(phase);
  const tabs = document.querySelectorAll('.phase-tab');
  if (tabs[idx]) tabs[idx].classList.add('active');

  document.body.classList.toggle('year-active', phase === 'year');
  document.body.classList.toggle('dashboard-active', phase === 'dashboard');
  document.body.classList.toggle('plan-active', phase === 'plan');
  if (phase !== 'dashboard') {
    document.body.classList.remove('dash-show-day', 'dash-show-board');
  }

  if (phase === 'plan') renderPlan();
  if (phase === 'dashboard') renderDashboard();
  if (phase === 'skills') {
    renderSkillsPanel(document.getElementById('skills-panel'));
    const el = document.getElementById('lno-week-stat');
    if (el) {
      const s = weekLnoStats();
      el.textContent = s.total
        ? `This week: ${s.pct}% of scheduled minutes on L (${s.lMins}m / ${s.total}m)`
        : 'This week: no scheduled minutes yet — tag L/N/O in Plan.';
    }
  }
  if (phase === 'year') {
    ensureYearWeekMonday();
    // Phones land on Month, not the 12-month Year overview
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches
        && state.yearCalendarView === 'year') {
      state.yearCalendarView = 'month';
    }
    renderYear();
  }
}

export function clearAll() {
  if (!confirm('Clear all tasks and start fresh?')) return;
  state.tasks = [];
  state.groups = [];
  state.groupCounter = 0;
  state.schedule = [];
  state.planWizardIndex = 0;
  state.planWizardStep = 'size';
  deps.save();
  render();
  deps.switchPhase('plan');
}
