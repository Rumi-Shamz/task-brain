/**
 * Defer a scheduled task: to a picked date, to the backlog (Someday), or by a week / 4 weeks. Moving
 * by 7 or 28 days keeps the weekday and the time. The day it left goes to `deferred`, so the weekly
 * review can show it as moved on purpose, not as slipped.
 */
import { state, esc, formatYmd, parseYmd, addDaysLocal } from './state.js';
import { deps } from './deps.js';
import { act, actOn, registerActions, stop, stopOn } from './actions.js';
import { weekdayIndex } from './blocks.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Next week = +7 days, next month = +28 days, counted from the task's day (or today if it has none). */
export function deferTargets(t, today = formatYmd(new Date())) {
  const base = parseYmd(t.date || today);
  return {
    week: formatYmd(addDaysLocal(base, 7)),
    month: formatYmd(addDaysLocal(base, 28)),
  };
}

/** Move the task to ymd (keeps its time), or to the backlog when ymd is null. */
export function deferTask(id, ymd) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  const from = t.date;
  // A slipped task gets a decision here: it leaves Needs you until it slips again.
  if (Array.isArray(t.missed) && t.missed.length) t.slipHandled = [...t.missed].sort().pop();
  if (from && from !== ymd) {
    if (!Array.isArray(t.deferred)) t.deferred = [];
    if (!t.deferred.includes(from)) t.deferred.push(from);
  }
  if (ymd) {
    t.date = ymd;
    t.blockId = null;
    // Scheduling a backlog item takes it out of the backlog.
    if (t.status === 'someday') Object.assign(t, { status: 'todo', reviewAt: null, reviewSkips: 0, deleteCandidate: false });
  } else {
    t.status = 'someday';
    t.date = null;
    t.start = null;
    t.interval = null;
    t.blockId = null;
    t.reviewAt = formatYmd(addDaysLocal(new Date(), 14));
  }
  closeDeferMenu();
  deps.save();
  deps.renderDashboard();
  deps.renderYear();
}

export function closeDeferMenu() {
  if (typeof document !== 'undefined') document.getElementById('defer-menu')?.remove();
}

function shortDate(ymd) {
  const d = parseYmd(ymd);
  return `${WEEKDAYS[weekdayIndex(ymd)]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

/** The menu next to the task's Defer button. */
export function openDeferMenu(id, ev) {
  if (ev) ev.stopPropagation();
  closeDeferMenu();
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const to = deferTargets(t);
  const backlog = t.status === 'someday';
  // Phones fire change while the date wheel or calendar is still open, so a tap there only picks
  // the date and Move applies it. A mouse picks in one go.
  const confirmPick = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const menu = document.createElement('div');
  menu.id = 'defer-menu';
  menu.className = 'defer-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Defer task');
  stopOn(menu, 'pointerdown', 'click');
  menu.innerHTML = `
    <div class="defer-title">${backlog ? 'Schedule' : 'Defer'} “${esc(t.name)}”</div>
    <div class="defer-row">
      <label class="defer-pill defer-date" title="Pick a date (keeps ${esc(t.start || 'the time')})">Pick date
        <input type="date" aria-label="Pick a date" ${act('showPicker', '$el')} min="${formatYmd(addDaysLocal(new Date(), 1))}"${actOn('change', confirmPick ? 'deferPickDate' : 'deferToValue', t.id, '$value')} />
      </label>
      ${confirmPick ? `<button type="button" class="defer-pill defer-confirm" id="defer-confirm" hidden ${act('deferConfirm', t.id)}>Move</button>` : ''}
      ${backlog ? '' : `<button type="button" class="defer-pill" ${act('deferTask', t.id, null)} title="Off the calendar, into the backlog (review in 14 days)">Backlog</button>`}
    </div>
    <select class="defer-select" aria-label="Move by" ${actOn('change', 'deferToValue', t.id, '$value')}>
      <option value="">Move by…</option>
      <option value="${to.week}">Next week · ${esc(shortDate(to.week))}${t.start ? ` ${esc(t.start)}` : ''}</option>
      <option value="${to.month}">Next month · ${esc(shortDate(to.month))}${t.start ? ` ${esc(t.start)}` : ''}</option>
    </select>`;
  document.body.appendChild(menu);
  const r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : null;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = r ? Math.min(window.innerWidth - w - 8, Math.max(8, r.left)) : (window.innerWidth - w) / 2;
  const top = r ? (r.bottom + h + 8 < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)) : 80;
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;
}

/** Done box on a task card; same size and style as the Defer button beside it. */
export function doneBoxHTML(t) {
  return `<input type="checkbox" class="chip-done card-btn" ${t.done ? 'checked' : ''}
    ${stop('pointerdown', 'click')}${act('toggleTaskDone', t.id, '$checked')} title="Mark done" aria-label="Mark done" />`;
}

/** Defer button beside the done box, on every open task (one without a day gets a day or the backlog). */
export function deferButtonHTML(t) {
  if (!t || t.done) return '';
  return `<button type="button" class="chip-defer card-btn" title="Defer: pick a date, backlog, next week or month" aria-label="Defer"
    ${stop('pointerdown', 'click')}${act('openDeferMenu', t.id, '$event')}>⇥</button>`;
}

/** Menu inputs: ignore an emptied value, like the placeholder option "Move by…". */
export function deferToValue(id, value) { if (value) deferTask(id, value); }

/** Phone: a picked date shows on the Move button; nothing moves yet. */
export function deferPickDate(id, value) {
  const b = document.getElementById('defer-confirm');
  if (!b) return;
  b.hidden = !value;
  if (value) b.textContent = `Move to ${shortDate(value)}`;
}

/** Phone: Move applies the picked date. */
export function deferConfirm(id) {
  const input = document.querySelector('#defer-menu input[type="date"]');
  deferToValue(id, input && input.value);
}

registerActions({
  deferToValue,
  deferPickDate,
  deferConfirm,
  deferTask,
  openDeferMenu,
  showPicker: el => { try { el.showPicker(); } catch (e) { /* not supported or not allowed */ } },
});

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest || !e.target.closest('#defer-menu')) closeDeferMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDeferMenu(); });
}
