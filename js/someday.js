/** Someday review queue + discard rule (T6). */
import { state, newTask, formatYmd, addDaysLocal, mondayOnOrBefore, esc } from './state.js';
import { deps } from './deps.js';

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
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function somedayDefer(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  bumpReview(t, 14);
  deps.save();
  renderSomedayPanel();
}

export function renderSomedayPanel(el) {
  const root = el || document.getElementById('someday-panel');
  if (!root) return;
  const due = somedayDue();
  root.innerHTML = `
    <h3 class="someday-title">Someday review</h3>
    <p class="someday-hint">Due this week: decide delegate → next action → delete → or push review.</p>
    ${due.length ? due.map(t => `
      <div class="someday-card ${t.deleteCandidate ? 'delete-candidate' : ''}">
        <div class="someday-name">${esc(t.name)}${t.deleteCandidate ? ' <em>(delete candidate — skipped 3×)</em>' : ''}</div>
        <div class="someday-meta">reviewAt ${esc(t.reviewAt || '—')} · skips ${t.reviewSkips || 0}</div>
        <div class="someday-actions">
          <button type="button" class="btn" onclick="somedayDelegate('${t.id}')">1. Delegate</button>
          <button type="button" class="btn" onclick="somedayConvert('${t.id}')">2. Next action</button>
          <button type="button" class="btn" onclick="somedayDelete('${t.id}')">3. Delete</button>
          <button type="button" class="btn" onclick="somedayDefer('${t.id}')">4. Push review</button>
        </div>
      </div>`).join('') : '<p class="dash-inbox-empty">No someday items due.</p>'}`;
}
