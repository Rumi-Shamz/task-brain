/** Skills backlog + Learn row helpers (T5). */
import { state, newTask, formatYmd, addDaysLocal } from './state.js';
import { nextOpenWeekday } from './blocks.js';
import { deps } from './deps.js';

export function skillQuadrant(utility, timeToLearn) {
  const u = utility === 'high' ? 'high' : 'low';
  const t = timeToLearn === 'high' ? 'high' : 'low';
  if (u === 'high' && t === 'low') return 'now';
  if (u === 'high' && t === 'high') return 'schedule';
  if (u === 'low' && t === 'low') return 'opportunistic';
  return 'decide';
}

export function normalizeSkill(s) {
  if (!s || typeof s !== 'object') return null;
  const utility = s.utility === 'high' ? 'high' : 'low';
  const timeToLearn = s.timeToLearn === 'high' ? 'high' : 'low';
  return {
    id: s.id || ('sk-' + Math.random().toString(36).slice(2, 8)),
    name: String(s.name || '').trim() || 'Skill',
    utility,
    timeToLearn,
    quadrant: skillQuadrant(utility, timeToLearn),
    ...(s.updatedAt ? { updatedAt: s.updatedAt } : {}),
  };
}

export function ensureSkills() {
  if (!Array.isArray(state.skills)) state.skills = [];
  state.skills = state.skills.map(normalizeSkill).filter(Boolean);
}

export function addSkill(name, utility, timeToLearn) {
  ensureSkills();
  const sk = normalizeSkill({ name, utility, timeToLearn });
  state.skills.push(sk);
  if (sk.quadrant === 'schedule') ensureWeeklyLearnBlock(sk);
  deps.save();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
  return sk;
}

/** Place a weekly Learn activity task on this week's Monday morning if missing. */
export function ensureWeeklyLearnBlock(skill) {
  const date = nextOpenWeekday(new Date(), 0);
  const name = `Learn: ${skill.name}`;
  const exists = state.tasks.some(t => t.date === date && t.name === name && t.activity === 'learn');
  if (exists) return;
  state.tasks.push(newTask(name, {
    projectId: 'personal',
    project: 'personal',
    domain: 'Personal',
    activity: 'learn',
    lane: 'learn',
    date,
    start: '09:00',
    duration: 60,
    status: 'todo',
    skillId: skill.id,
    lno: 'L',
  }));
}

/** After completing a learn session, schedule spaced reviews. */
export function createLearnReviews(task) {
  if (!task || task.activity !== 'learn') return;
  const base = task.date ? new Date(task.date + 'T12:00:00') : new Date();
  [1, 7, 30].forEach(days => {
    const d = addDaysLocal(base, days);
    const name = `Review: ${task.name.replace(/^Learn:\s*/i, '')} (+${days}d)`;
    const date = formatYmd(d);
    if (state.tasks.some(t => t.name === name && t.date === date)) return;
    state.tasks.push(newTask(name, {
      projectId: task.projectId || task.project,
      project: task.projectId || task.project,
      domain: task.domain || 'Personal',
      activity: 'learn',
      lane: 'learn',
      date,
      start: '09:00',
      duration: 30,
      status: 'todo',
      skillId: task.skillId || null,
      lno: 'N',
    }));
  });
  deps.save();
}

export function renderSkillsPanel(el) {
  if (!el) return;
  ensureSkills();
  const order = ['now', 'schedule', 'opportunistic', 'decide'];
  const labels = {
    now: 'Now (high utility, low time)',
    schedule: 'Schedule weekly (high / high)',
    opportunistic: 'Opportunistic (low / low)',
    decide: 'Decide (low utility, high time)',
  };
  el.innerHTML = `
    <div class="skills-add">
      <input type="text" id="skill-name" placeholder="Skill to learn…" />
      <select id="skill-util"><option value="high">Utility high</option><option value="low">Utility low</option></select>
      <select id="skill-time"><option value="low">Time low</option><option value="high">Time high</option></select>
      <button type="button" class="btn" onclick="addSkillFromForm()">Add skill</button>
    </div>
    ${order.map(q => {
      const items = state.skills.filter(s => s.quadrant === q);
      return `<div class="skills-quad"><h4>${labels[q]}</h4>
        ${items.length ? `<ul>${items.map(s => `<li>${s.name}</li>`).join('')}</ul>` : '<p class="dash-inbox-empty">None</p>'}
      </div>`;
    }).join('')}`;
}

export function addSkillFromForm() {
  const name = (document.getElementById('skill-name') || {}).value || '';
  const utility = (document.getElementById('skill-util') || {}).value || 'high';
  const timeToLearn = (document.getElementById('skill-time') || {}).value || 'low';
  if (!name.trim()) return;
  addSkill(name.trim(), utility, timeToLearn);
  const inp = document.getElementById('skill-name');
  if (inp) inp.value = '';
}

// Hook done toggle for learn reviews — called from state.toggleTaskDone via patch below
export function onTaskDoneMaybeLearn(t, becameDone) {
  if (becameDone && t.activity === 'learn' && !String(t.name).startsWith('Review:')) {
    createLearnReviews(t);
  }
}
