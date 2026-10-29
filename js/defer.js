/**
 * Defer a scheduled task: to a day next week, +1 week / month / 3 months, a picked date, or the backlog
 * (Someday). The time of day stays. The day it left goes to `deferred`, so the weekly review can show
 * it as moved on purpose, not as slipped.
 */
import { state, esc, formatYmd, parseYmd, addDaysLocal, mondayOnOrBefore } from './state.js';
import { deps } from './deps.js';
import { isTaskDay, weekdayIndex } from './blocks.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function taskDay(ymd) {
  // Without a year rhythm every weekday is a work day.
  return state.yearRhythm ? isTaskDay(ymd) : weekdayIndex(ymd) < 5;
}

/** First work day on or after ymd (up to two weeks on), else ymd itself. */
export function onOrAfterWorkDay(ymd) {
  let d = parseYmd(ymd);
  for (let i = 0; i < 14 && d; i++, d = addDaysLocal(d, 1)) {
    if (taskDay(formatYmd(d))) return formatYmd(d);
  }
  return ymd;
}

function addMonths(ymd, n) {
  const d = parseYmd(ymd);
  const day = d.getDate();
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  // 31 Jan + 1 month = 28/29 Feb, not 3 Mar.
  out.setDate(Math.min(day, new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  return formatYmd(out);
}

/** Where each option would put the task. From its own day, or from today if that has passed. */
export function deferTargets(t, today = formatYmd(new Date())) {
  const base = t.date && t.date > today ? t.date : today;
  const nextMon = mondayOnOrBefore(addDaysLocal(parseYmd(today), 7));
  const nextWeek = Array.from({ length: 7 }, (_, i) => formatYmd(addDaysLocal(nextMon, i))).filter(taskDay);
  return {
    nextWeek,
    week: onOrAfterWorkDay(formatYmd(addDaysLocal(parseYmd(base), 7))),
    month: onOrAfterWorkDay(addMonths(base, 1)),
    quarter: onOrAfterWorkDay(addMonths(base, 3)),
  };
}

/** Move the task to ymd (keeps its time), or to the backlog when ymd is null. */
export function deferTask(id, ymd) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  const from = t.date;
  if (from && from !== ymd) {
    if (!Array.isArray(t.deferred)) t.deferred = [];
    if (!t.deferred.includes(from)) t.deferred.push(from);
  }
  if (ymd) {
    t.date = ymd;
    t.blockId = null;
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
  const btn = (ymd, label) => `<button type="button" class="btn" onclick="deferTask('${esc(t.id)}', '${ymd}')">${esc(label)}</button>`;
  const menu = document.createElement('div');
  menu.id = 'defer-menu';
  menu.className = 'defer-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Defer task');
  menu.onpointerdown = e => e.stopPropagation();
  menu.onclick = e => e.stopPropagation();
  menu.innerHTML = `
    <div class="defer-title">Defer “${esc(t.name)}”${t.start ? ` · keeps ${esc(t.start)}` : ''}</div>
    <div class="defer-label">Next week</div>
    <div class="defer-row">${to.nextWeek.map(d => btn(d, shortDate(d))).join('')}</div>
    <div class="defer-row">
      ${btn(to.week, `+1 week · ${shortDate(to.week)}`)}
      ${btn(to.month, `+1 month · ${shortDate(to.month)}`)}
      ${btn(to.quarter, `+3 months · ${shortDate(to.quarter)}`)}
    </div>
    <div class="defer-row">
      <input type="date" aria-label="Pick a date" min="${formatYmd(addDaysLocal(new Date(), 1))}" onchange="if (this.value) deferTask('${esc(t.id)}', this.value)" />
      <button type="button" class="btn" onclick="deferTask('${esc(t.id)}', null)" title="Off the calendar, into Someday (review in 14 days)">Backlog</button>
      <button type="button" class="btn defer-cancel" onclick="closeDeferMenu()">Cancel</button>
    </div>`;
  document.body.appendChild(menu);
  const r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : null;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const left = r ? Math.min(window.innerWidth - w - 8, Math.max(8, r.left)) : (window.innerWidth - w) / 2;
  const top = r ? (r.bottom + h + 8 < window.innerHeight ? r.bottom + 4 : Math.max(8, r.top - h - 4)) : 80;
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;
}

/** The small button next to the done box. Only for open tasks that sit on a day. */
export function deferButtonHTML(t) {
  if (!t || t.done || !t.date) return '';
  return `<button type="button" class="chip-defer" title="Defer: next week, later, or backlog" aria-label="Defer"
    onpointerdown="event.stopPropagation()" onclick="event.stopPropagation(); openDeferMenu('${esc(t.id)}', event)">⇥</button>`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest || !e.target.closest('#defer-menu')) closeDeferMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDeferMenu(); });
}
