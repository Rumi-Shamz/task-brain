/** Someday review queue + discard rule (T6). */
import { state, newTask, formatYmd, addDaysLocal, mondayOnOrBefore, esc } from './state.js';
import { deps } from './deps.js';
import { slippedTasks } from './blocks.js';
import { allDomains, domainStyleVar } from './domains.js';
import { act } from './actions.js';

/** Open tasks missed this many times are flagged like a thrice-skipped someday item. */
export const SLIP_FLAG = 3;

export function todayYmdLocal() {
  return formatYmd(new Date());
}

export function somedayDue(nowYmd = todayYmdLocal()) {
  return state.tasks.filter(t => {
    if (t.status !== 'someday') return false;
    if (!t.reviewAt) return true;
    return t.reviewAt <= nowYmd;
  }).sort((a, b) => String(a.reviewAt || '').localeCompare(String(b.reviewAt || '')));
}

function bumpReview(t, days = 14) {
  const base = t.reviewAt ? new Date(t.reviewAt + 'T12:00:00') : new Date();
  t.reviewAt = formatYmd(addDaysLocal(base, days));
  t.reviewSkips = (t.reviewSkips || 0) + 1;
  if (t.reviewSkips >= 3) t.deleteCandidate = true;
}

export function somedayDelegate(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = 'todo';
  t.done = false;
  t.activity = 'communicate';
  t.lane = 'communicate';
  if (t.assignee === 'me') t.assignee = 'person';
  t.reviewAt = null;
  t.reviewSkips = 0;
  t.deleteCandidate = false;
  if (!t.date) t.date = formatYmd(mondayOnOrBefore(new Date()));
  if (!t.start) t.start = '13:00';
  deps.save();
  renderSomedayPanel();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function somedayConvert(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = 'todo';
  t.done = false;
  t.activity = t.activity || 'act';
  t.lane = t.activity;
  t.reviewAt = null;
  t.reviewSkips = 0;
  t.deleteCandidate = false;
  if (!t.date) t.date = formatYmd(mondayOnOrBefore(new Date()));
  deps.save();
  renderSomedayPanel();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function somedayDelete(id) {
  state.tasks = state.tasks.filter(x => x.id !== id);
  deps.save();
  renderSomedayPanel();
  renderSlippedPanel();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function somedayDefer(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  bumpReview(t, 14);
  deps.save();
  renderSomedayPanel();
}

/** Backlog: every parked task, by domain. Items due for review also show in Act → Needs you. */
export function renderSomedayPanel(el) {
  const root = el || document.getElementById('someday-panel');
  if (!root) return;
  const dueIds = new Set(somedayDue().map(t => t.id));
  const all = state.tasks.filter(t => t.status === 'someday' && !t.parentId);
  const byDomain = new Map();
  all.forEach(t => {
    const k = t.domain || '';
    if (!byDomain.has(k)) byDomain.set(k, []);
    byDomain.get(k).push(t);
  });
  const groups = allDomains().map(d => [d.id, d.label]).concat([['', 'No domain']])
    .filter(([id]) => byDomain.has(id))
    .map(([id, label]) => `<div class="backlog-group" style="${domainStyleVar(id)}">
      <div class="backlog-domain"><span class="project-dot"></span>${esc(label)} <span class="domain-count">${byDomain.get(id).length}</span></div>
      ${byDomain.get(id).map(t => `<div class="backlog-row">
        <span class="backlog-name">${esc(t.name)}</span>
        <span class="someday-meta">${dueIds.has(t.id) ? 'review now' : `review ${esc(t.reviewAt || '—')}`}</span>
        <button type="button" class="btn" ${act('openDeferMenu', t.id, '$event')}>Schedule</button>
        <button type="button" class="btn" ${act('somedayDelete', t.id)} title="Delete" aria-label="Delete">✕</button>
      </div>`).join('')}
    </div>`).join('');
  const summary = document.getElementById('someday-summary');
  if (summary) summary.innerHTML = `Backlog${all.length ? ` <span class="panel-count">${all.length}</span>` : ''}`;
  root.innerHTML = groups || '<p class="dash-inbox-empty">The backlog is empty. Defer a task to Backlog to park it here.</p>';
}

export function slippedToSomeday(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.status = 'someday';
  t.done = false;
  t.date = null;
  t.start = null;
  t.interval = null;
  t.blockId = null;
  t.reviewAt = formatYmd(addDaysLocal(new Date(), 14));
  deps.save();
  renderSlippedPanel();
  renderSomedayPanel();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function renderSlippedPanel(el) {
  const root = el || document.getElementById('slipped-panel');
  if (!root) return;
  const list = slippedTasks();
  root.innerHTML = `
    <p class="someday-hint">Open tasks whose day passed. They moved to the next open weekday; each miss is kept.</p>
    ${list.length ? list.map(t => `
      <div class="someday-card ${t.missed.length >= SLIP_FLAG ? 'delete-candidate' : ''}">
        <div class="someday-name">${esc(t.name)}${t.missed.length >= SLIP_FLAG ? ` <em>(slipped ${t.missed.length}× — still worth doing?)</em>` : ''}</div>
        <div class="someday-meta">missed ${esc(t.missed.join(', '))} · now ${esc(t.date || '—')}</div>
        <div class="someday-actions">
          <button type="button" class="btn" ${act('slippedToSomeday', t.id)}>Move to backlog</button>
          <button type="button" class="btn" ${act('somedayDelete', t.id)}>Delete</button>
        </div>
      </div>`).join('') : '<p class="dash-inbox-empty">Nothing slipped.</p>'}`;
}
