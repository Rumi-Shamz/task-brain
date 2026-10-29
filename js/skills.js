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

/** The four places a skill can sit: how useful it is × how long it takes to learn. */
export const QUADRANTS = {
  now: { title: 'Learn now', hint: 'Useful and quick to learn' },
  schedule: { title: 'Learn every week', hint: 'Useful, takes time: gets a weekly Learn session' },
  opportunistic: { title: 'Pick up when handy', hint: 'Less useful, quick to learn' },
  decide: { title: 'Worth it?', hint: 'Less useful, takes time: decide or drop' },
};

const esc = v => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSkillsPanel(el) {
  if (!el) return;
  ensureSkills();
  const cell = q => {
    const items = state.skills.filter(s => s.quadrant === q);
    return `<div class="skill-cell skill-${q}">
      <h3>${QUADRANTS[q].title}</h3>
      <p class="skill-hint">${QUADRANTS[q].hint}</p>
      <div class="skill-chips">${items.length
        ? items.map(s => `<span class="skill-chip">${esc(s.name)}<button type="button" onclick="removeSkill('${esc(s.id)}')" aria-label="Remove ${esc(s.name)}">✕</button></span>`).join('')
        : '<span class="skill-empty">Nothing here yet</span>'}</div>
    </div>`;
  };
  el.innerHTML = `
    <form class="skills-add" onsubmit="event.preventDefault(); addSkillFromForm()">
      <input type="text" id="skill-name" placeholder="A skill to learn" aria-label="Skill to learn" />
      <fieldset class="seg" aria-label="How useful">
        <label><input type="radio" name="skill-util" value="high" checked /><span>Very useful</span></label>
        <label><input type="radio" name="skill-util" value="low" /><span>Nice to have</span></label>
      </fieldset>
      <fieldset class="seg" aria-label="Time to learn">
        <label><input type="radio" name="skill-time" value="low" checked /><span>Quick</span></label>
        <label><input type="radio" name="skill-time" value="high" /><span>Takes time</span></label>
      </fieldset>
      <button type="submit" class="btn primary">Add skill</button>
    </form>
    <div class="skill-matrix">
      <span class="axis axis-y" aria-hidden="true">More useful ↑</span>
      <span class="axis axis-x" aria-hidden="true">Longer to learn →</span>
      ${cell('now')}${cell('schedule')}${cell('opportunistic')}${cell('decide')}
    </div>`;
}

/** Side of Develop: Leverage share this week, learn sessions this week, reviews coming up. */
export function renderDevelopSide(el, lno, today = formatYmd(new Date())) {
  if (!el) return;
  const mon = new Date(); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => formatYmd(addDaysLocal(mon, i)));
  const sessions = state.tasks.filter(t => t.activity === 'learn' && week.includes(t.date) && !String(t.name).startsWith('Review:'));
  const reviews = state.tasks.filter(t => String(t.name).startsWith('Review:') && !t.done && t.date && t.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const hours = m => (m / 60).toFixed(m % 60 ? 1 : 0);
  const row = t => `<li class="${t.done ? 'done' : ''}"><label><input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTaskDone('${esc(t.id)}', this.checked)" />
      <span>${esc(t.name.replace(/^Learn:\s*/, ''))}</span></label><span class="develop-date">${esc(t.date.slice(5))}</span></li>`;
  el.innerHTML = `
    <section class="develop-card">
      <h3>Leverage this week</h3>
      ${lno.total ? `<div class="meter" role="img" aria-label="${lno.pct}% of scheduled time"><i style="width:${lno.pct}%"></i></div>
        <p class="develop-note">${lno.pct}% of your scheduled time is Leverage work (${hours(lno.lMins)}h of ${hours(lno.total)}h).</p>`
        : '<p class="develop-note">Nothing is scheduled this week yet. Mark tasks as Leverage in Organize to see the share here.</p>'}
    </section>
    <section class="develop-card">
      <h3>Learning this week</h3>
      ${sessions.length ? `<ul class="develop-list">${sessions.map(row).join('')}</ul>`
        : '<p class="develop-note">No learn sessions this week. Skills in “Learn every week” get one on Monday morning.</p>'}
    </section>
    <section class="develop-card">
      <h3>Reviews coming up</h3>
      ${reviews.length ? `<ul class="develop-list">${reviews.map(row).join('')}</ul>`
        : '<p class="develop-note">Finishing a learn session adds reviews after 1, 7 and 30 days.</p>'}
    </section>`;
}

export function removeSkill(id) {
  ensureSkills();
  state.skills = state.skills.filter(s => s.id !== id);
  deps.save();
  renderSkillsPanel(document.getElementById('skills-panel'));
}

export function addSkillFromForm() {
  const name = (document.getElementById('skill-name') || {}).value || '';
  const utility = document.querySelector('input[name="skill-util"]:checked')?.value || 'high';
  const timeToLearn = document.querySelector('input[name="skill-time"]:checked')?.value || 'low';
  if (!name.trim()) return;
  addSkill(name.trim(), utility, timeToLearn);
  renderSkillsPanel(document.getElementById('skills-panel'));
  document.getElementById('skill-name')?.focus();
}

// Hook done toggle for learn reviews — called from state.toggleTaskDone via patch below
export function onTaskDoneMaybeLearn(t, becameDone) {
  if (becameDone && t.activity === 'learn' && !String(t.name).startsWith('Review:')) {
    createLearnReviews(t);
  }
}
