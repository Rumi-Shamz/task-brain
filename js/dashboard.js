import {
  state, LANES, HOUR_H, VIEW_HOUR_START, VIEW_HOUR_END, VIEW_HOURS, VIEW_SCROLL_TOP,
  DAY_START_MIN, DAY_END_MIN, VISIBLE_MINUTES, DEFAULT_DURATION, CAL_DAY_START, CAL_DAY_END,
  CAL_SNAP, CAL_MIN_DURATION, projectClass, projectCssVars, projectColStyleAttr, chipControlsHTML,
  esc, pad2, formatYmd, parseYmd, parseHHMM, formatHHMM, snapCalMins, clampCalStart, todayYmd,
  ensureDashCalDate, formatTracked, taskElapsedMs, setHideDone, toggleTaskDone,
  startTaskTimer, pauseTaskTimer, stopTaskTimer, ensureTimerTick, isTopLevelTask, childTasksOf,
  mondayOnOrBefore, addDaysLocal,
} from './state.js';
import {
  allDomains, normalizeDomainId, addCustomDomain, domainStyleVar, domainDotHTML,
  toggleDomainCollapsed, setAllDomainsCollapsed,
} from './domains.js';
import { getProject, ACTIVITIES } from './projects.js';
import { deps } from './deps.js';
import { blocksOnDate, allDayOnDate } from './blocks.js';
import { seriesDetails } from './recurring.js';
import { renderNextUp, renderDelegatedPanel } from './next-up.js';
import { renderErrandsPanel } from './agent-ui.js';

export { takeBackTask } from './next-up.js';
import { openDashEdit, renderDashEditSheet } from './dashboard-edit.js';
import { deferButtonHTML, doneBoxHTML } from './defer.js';
import { isLocked, blockersOf } from './outcome.js';
import { renderNeedsYou } from './needs-you.js';

export * from './dashboard-drag.js';
export * from './dashboard-edit.js';

const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Importance (the old L / N / O field), as written on tags and in Organize. */
export const IMPORTANCE_LABEL = { L: 'Leverage', N: 'Neutral', O: 'Optional' };

/*
 * Hour rows of the day calendar. Night (23:00–06:00) can fold into thin rows; the waking hours then
 * share the panel's height. A device preference, so it is kept in this browser only.
 */
const NIGHT_ROW_H = 6;
const isNightHour = h => h < 6 || h >= 23;
let hourH = Array(24).fill(HOUR_H);
let hourTop = hourH.map((_, h) => h * HOUR_H).concat(24 * HOUR_H);

export function foldNightOn() {
  try { return localStorage.getItem('dayplanner_fold_night') === '1'; } catch (e) { return false; }
}

export function toggleFoldNight() {
  try { localStorage.setItem('dayplanner_fold_night', foldNightOn() ? '0' : '1'); } catch (e) {}
  state.dayCalScrolledOnce = false;
  renderDayCalendar();
}

function layoutHours(root) {
  if (!foldNightOn()) hourH = Array(24).fill(HOUR_H);
  else {
    const avail = root ? root.clientHeight : 0;
    const day = Math.max(HOUR_H, Math.floor((avail - 7 * NIGHT_ROW_H - 2) / 17));
    hourH = Array.from({ length: 24 }, (_, h) => (isNightHour(h) ? NIGHT_ROW_H : day));
  }
  hourTop = [0];
  hourH.forEach((v, h) => hourTop.push(hourTop[h] + v));
}

export function minsToY(mins) {
  const m = Math.max(CAL_DAY_START, Math.min(CAL_DAY_END, mins));
  const h = Math.min(23, Math.floor(m / 60));
  return hourTop[h] + ((m - h * 60) / 60) * hourH[h];
}
export function yToMins(y) {
  const v = Math.max(0, Math.min(hourTop[24], y));
  let h = 0;
  while (h < 23 && hourTop[h + 1] <= v) h++;
  return h * 60 + ((v - hourTop[h]) / hourH[h]) * 60;
}
/** Height of a block from start to start + duration (at least one readable line). */
export function spanToH(start, duration) { return Math.max(minsToY(start + duration) - minsToY(start), 28); }
export function applyCalBlockStyle(el, t) {
  const startMins = parseHHMM(t.start);
  if (startMins == null) return;
  const dur = t.duration || DEFAULT_DURATION;
  el.style.top = minsToY(startMins) + 'px';
  el.style.height = spanToH(startMins, dur) + 'px';
  const timeEl = el.querySelector('.cal-block-time');
  if (timeEl) timeEl.textContent = t.start + '–' + formatHHMM(startMins + dur);
}
export function chipHTML(t) {
  return boardRowHTML(t);
}

function activityLabel(act) {
  const id = act || 'act';
  return (ACTIVITIES.find(a => a.id === id) || LANES.find(a => a.id === id))?.label || id;
}

function weekdayShort(ymd) {
  const d = parseYmd(ymd);
  return d ? d.toLocaleDateString('en-GB', { weekday: 'short' }) : '';
}

/** One quiet line under the task name: project · importance · when · who · slipped · lock. */
function metaLineHTML(t, { showActivity = false } = {}) {
  const proj = getProject(t.projectId || t.project);
  const parts = [];
  if (showActivity) parts.push(esc(activityLabel(t.activity || t.lane || 'act')));
  if (proj) parts.push(esc(proj.name));
  if (t.lno) parts.push(esc(IMPORTANCE_LABEL[t.lno] || t.lno));
  if (t.date) {
    const wd = weekdayShort(t.date);
    parts.push(esc(t.start ? `${wd} ${t.start}` : wd));
  }
  if (t.assignee === 'person') parts.push(`→ ${esc(t.delegateTo || 'someone')}`);
  if (t.assignee === 'ai') parts.push('Assistant');
  if (!t.done && t.missed && t.missed.length) {
    parts.push(`<span class="meta-warn" title="Missed on ${esc(t.missed.join(', '))}">slipped ×${t.missed.length}</span>`);
  }
  if (!t.done) {
    const b = blockersOf(t);
    if (b.length) {
      parts.push(`<span class="meta-lock" title="Waits on: ${esc(b.map(x => x.name).join(', '))}">🔒 waits on ${esc(b[0].name)}${b.length > 1 ? ` +${b.length - 1}` : ''}</span>`);
    }
  }
  return parts.join(' · ');
}

export function boardRowHTML(t, { nested = false, showActivity = false } = {}) {
  const scheduled = !!(t.start && t.date);
  const running = !!t.timerStartedAt;
  const meta = metaLineHTML(t, { showActivity });
  return `<div class="board-row ${nested ? 'board-row-child' : ''} ${scheduled ? 'scheduled' : ''} ${t.done ? 'done' : ''} ${!t.done && isLocked(t) ? 'locked' : ''} ${running ? 'timer-running' : ''}"
      draggable="true" data-id="${t.id}"
      ondragstart="dashChipDragStart(event)" ondragend="dashChipDragEnd(event)"
      onclick="dashRowClick(event,'${t.id}')">
    <div class="board-row-main">
      <div class="board-row-text">
        <span class="board-row-name">${domainDotHTML(taskDomain(t))}${esc(t.name)}</span>
        ${meta ? `<span class="board-row-meta">${meta}</span>` : ''}
      </div>
    </div>
    <div class="board-row-controls card-actions" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">
      ${chipControlsHTML(t)}${doneBoxHTML(t)}${deferButtonHTML(t)}
    </div>
  </div>`;
}

export function dashRowClick(e, id) {
  if (e.target.closest('input, button, .chip-actions, .board-row-controls')) return;
  openDashEdit(id);
}

export function setDashActivityFilter(id) {
  state.dashActivityFilter = id || 'all';
  deps.renderProjectBoard();
}

export function shiftDashDay(delta) {
  if (!delta) {
    state.dashCalDate = todayYmd();
  } else {
    const cur = parseYmd(ensureDashCalDate()) || new Date();
    state.dashCalDate = formatYmd(addDaysLocal(cur, delta));
  }
  renderDayCalendar();
}

export function renderDayCalendar() {
  const root = document.getElementById('day-calendar');
  if (!root) return;
  const prevScroll = root.scrollTop;
  const ymd = ensureDashCalDate();
  const title = document.getElementById('dash-day-title');
  if (title) title.textContent = ymd === todayYmd() ? `Today · ${ymd}` : ymd;
  renderNextUp();
  const allDay = document.getElementById('dash-day-allday');
  if (allDay) {
    const items = allDayOnDate(ymd);
    allDay.hidden = !items.length;
    allDay.innerHTML = items.map(b => `<span class="allday-chip" style="${domainStyleVar(b.domain)}">${esc(b.name)}</span>`).join('');
  }
  const folded = foldNightOn();
  root.classList.toggle('night-folded', folded);
  const nightBtn = document.getElementById('night-toggle');
  if (nightBtn) {
    nightBtn.setAttribute('aria-pressed', String(folded));
    nightBtn.innerHTML = `☾<span class="night-label"> ${ folded ? 'Show night' : 'Fold night' }</span>`;
  }
  layoutHours(root);
  const hours = [];
  for (let h = 0; h < 24; h++) {
    hours.push(`<div class="day-hour ${ folded && isNightHour(h) ? 'night' : '' }" data-hour="${ h }" style="height:${ hourH[h] }px">
      <div class="day-hour-label">${ pad2(h) }:00</div>
      <div class="day-slot"
        ondragover="calSlotDragOver(event)"
        ondragleave="calSlotDragLeave(event)"
        ondrop="calSlotDrop(event, ${ h })"></div>
    </div>`);
  }
  const dayTasks = state.tasks.filter(t => t.date === ymd && t.start && !(state.hideDone && t.done));
  const blocks = dayTasks.map(t => {
    const startMins = parseHHMM(t.start);
    if (startMins == null) return '';
    const dur = t.duration || DEFAULT_DURATION;
    const running = !!t.timerStartedAt;
    const endLabel = formatHHMM(startMins + dur);
    return `<div class="cal-block ${ projectClass(t.project) } ${ t.done ? 'done' : '' } ${ running ? 'timer-running' : '' }" data-id="${ t.id }"
        style="${ projectCssVars(t.project) }${ domainStyleVar(taskDomain(t)) }top:${ minsToY(startMins) }px;height:${ spanToH(startMins, dur) }px;"
        title="${ esc(t.name) } · ${ esc(t.start) }–${ esc(endLabel) }"
        onpointerdown="calBlockPointerDown(event)">
      <div class="cal-block-top">
        <div class="cal-block-name">${ esc(t.name) }</div>
        <div class="card-actions" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">
          ${ chipControlsHTML(t) }${ doneBoxHTML(t) }${ deferButtonHTML(t) }
        </div>
      </div>
      <div class="cal-resize" data-resize="1"></div>
    </div>`;
  }).join('');
  const bands = blocksOnDate(ymd).map(b => {
    const top = minsToY(b.startMin);
    const height = Math.max(0, minsToY(b.endMin) - top);
    return `<div class="cal-protocol ${b.rule === 'event' ? 'event' : 'open'}" style="${domainStyleVar(b.domain)}top:${top}px;height:${height}px"
        title="${esc(b.name)} · ${esc(formatHHMM(b.startMin))}–${esc(formatHHMM(b.endMin))} · ${esc(seriesDetails(b))}">
      <span>${esc(b.name)}</span>
    </div>`;
  }).join('');
  root.innerHTML = `<div class="day-hours" style="height:${ hourTop[24] }px;min-height:0">${ hours.join('') }</div><div class="cal-blocks" style="height:${ hourTop[24] }px;min-height:0">${ bands }${ blocks }</div>`;
  if (state.dayCalScrolledOnce) root.scrollTop = prevScroll;
  else { root.scrollTop = folded ? 0 : VIEW_SCROLL_TOP; state.dayCalScrolledOnce = true; }
}

export function taskDomain(t) {
  const d = normalizeDomainId(t.domain);
  if (d) return d;
  const p = getProject(t.projectId || t.project);
  if (p) return normalizeDomainId(p.domain) || (p.domains && p.domains[0]) || 'Personal';
  return null;
}

function domainHasTasks(domainId) {
  return state.tasks.some(t => t.status !== 'someday' && taskDomain(t) === domainId);
}

function isCollapsed(domainId) {
  if (Array.isArray(state.collapsedDomains)) {
    return state.collapsedDomains.includes(domainId);
  }
  // Default: every domain shown; empty ones fold into the "Nothing this week" line.
  return false;
}

function matchesActivityFilter(t) {
  const f = state.dashActivityFilter || 'all';
  if (f === 'all') return true;
  const act = t.activity || t.lane || 'act';
  if (f === 'learn') return act === 'learn';
  if (f === 'research') return act === 'research';
  return act === f;
}

const IMP_RANK = { L: 0, N: 1, O: 2 };

/** Today first, then date ascending, undated last; ties: Leverage, Neutral, Optional, none; then name. */
function boardSort(a, b) {
  const today = todayYmd();
  const ta = a.date === today ? 0 : 1, tb = b.date === today ? 0 : 1;
  if (ta !== tb) return ta - tb;
  const da = a.date || '9999-99-99', db = b.date || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  if (a.date && b.date && (a.start || '') !== (b.start || '')) return (a.start || '99') < (b.start || '99') ? -1 : 1;
  const ia = IMP_RANK[a.lno] ?? 3, ib = IMP_RANK[b.lno] ?? 3;
  if (ia !== ib) return ia - ib;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

export function toggleAddDomain(open) {
  const bar = document.querySelector('.board-toolbar');
  const inp = document.getElementById('new-domain-input');
  if (!bar) return;
  const on = open === undefined ? !bar.classList.contains('adding') : !!open;
  bar.classList.toggle('adding', on);
  const btn = document.getElementById('add-domain-chip');
  if (btn) btn.setAttribute('aria-expanded', String(on));
  if (on && inp) inp.focus();
  if (!on && inp) { inp.value = ''; inp.placeholder = 'New domain…'; }
}

export function renderProjectBoard() {
  const board = document.getElementById('project-board');
  if (!board) return;
  // Act is about this week: tasks dated after Sunday (deferred, planned ahead) stay on Plan until their week.
  const weekEnd = formatYmd(addDaysLocal(mondayOnOrBefore(new Date()), 6));
  const later = t => !!t.date && t.date > weekEnd;
  const visible = (list) => list.filter(t => !later(t) && !(state.hideDone && t.done));
  const activities = ACTIVITIES.length ? ACTIVITIES : LANES;
  const domains = allDomains();
  const filter = state.dashActivityFilter || 'all';
  const showActivity = filter === 'all';

  const rootsOf = dom => visible(state.tasks.filter(t =>
    t.status !== 'someday' && isTopLevelTask(t) && taskDomain(t) === dom.id && matchesActivityFilter(t)
  )).sort(boardSort);
  const rowsFor = roots => roots.map(t => {
    const kids = visible(childTasksOf(t.id).filter(matchesActivityFilter)).sort(boardSort);
    return boardRowHTML(t, { showActivity }) + kids.map(c => boardRowHTML(c, { nested: true, showActivity })).join('');
  }).join('');

  // One control row: a chip per domain (click to show or hide it).
  const strip = document.getElementById('domain-chip-strip');
  if (strip) {
    strip.innerHTML = domains.map(dom => {
      const hidden = isCollapsed(dom.id);
      const count = rootsOf(dom).length;
      return `<button type="button" class="domain-chip ${hidden ? 'is-hidden' : ''}" data-domain="${dom.id}" style="${domainStyleVar(dom.id)}"
          aria-pressed="${!hidden}" onclick="toggleDomainCol('${dom.id}')" title="${hidden ? 'Show' : 'Hide'} ${esc(dom.label)}">
        <span class="project-dot"></span>
        <span class="domain-chip-label">${esc(dom.label)}</span>
        <span class="domain-count">${count}</span>
      </button>`;
    }).join('');
  }

  const filterChips = `<div class="board-activity-filters">
    <button type="button" class="btn ${filter === 'all' ? 'primary' : ''}" onclick="setDashActivityFilter('all')">All</button>
    ${activities.map(a =>
      `<button type="button" class="btn ${filter === a.id ? 'primary' : ''}" onclick="setDashActivityFilter('${a.id}')">${esc(activityLabel(a.id))}</button>`
    ).join('')}
  </div>`;

  const shownDoms = domains.filter(d => !isCollapsed(d.id));
  let body = '';
  if (!shownDoms.length) {
    body = '<div class="dash-inbox-empty">All domains hidden. Click a chip above to show one.</div>';
  } else if (!showActivity) {
    // Batch mode: one flat list across the shown domains.
    const roots = shownDoms.flatMap(rootsOf).sort(boardSort);
    const n = roots.length;
    body = `<div class="project-col act-batch">
      <div class="act-batch-head">${esc(activityLabel(filter))} · ${n} task${n === 1 ? '' : 's'} this week</div>
      <div class="domain-task-rows">${rowsFor(roots) || '<div class="dash-inbox-empty domain-empty">Nothing this week.</div>'}</div>
    </div>`;
  } else {
    const empty = [];
    const cards = shownDoms.map(dom => {
      const roots = rootsOf(dom);
      if (!roots.length) { empty.push(dom.label); return ''; }
      const laterCount = state.tasks.filter(t => t.status !== 'someday' && !t.done && isTopLevelTask(t) && taskDomain(t) === dom.id && later(t)).length;
      const laterNote = laterCount
        ? `<div class="board-later" title="Dated after this week: they show up here in their week, and on Plan now">+ ${laterCount} later</div>` : '';
      return `<div class="project-col domain-col domain-stack" data-domain="${dom.id}" style="${domainStyleVar(dom.id)}"
          ondragover="boardDragOver(event)" ondragleave="boardDragLeave(event)"
          ondrop="dropOnDomainStack(event)">
        <div class="act-dom-head">
          <span class="project-dot"></span>
          <span class="domain-toggle-label">${esc(dom.label)}</span>
          <span class="domain-count">${roots.length}</span>
        </div>
        <div class="domain-task-rows">${rowsFor(roots)}</div>${laterNote}
      </div>`;
    }).join('');
    body = cards + (empty.length ? `<div class="act-nothing">Nothing this week: ${empty.map(esc).join(', ')}</div>` : '');
  }

  board.innerHTML = filterChips + body;

  const inbox = visible(state.tasks.filter(t => !taskDomain(t) && t.status !== 'someday' && isTopLevelTask(t)));
  const inboxEl = document.getElementById('dash-inbox-chips');
  if (inboxEl) {
    inboxEl.innerHTML = inbox.length
      ? inbox.map(t => boardRowHTML(t)).join('')
      : '<div class="dash-inbox-empty">Tasks without a domain land here. Click a row to edit, or drag onto the day calendar to schedule.</div>';
  }
  const toggle = document.getElementById('hide-done-toggle');
  if (toggle) toggle.checked = state.hideDone;
  ensureTimerTick();
  if (state.dashEditId) renderDashEditSheet();
}

export function dropOnDomainStack(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const id = e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain') || state.dashDragId;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.domain = e.currentTarget.dataset.domain;
  deps.save();
  deps.renderDashboard();
}

export function toggleDomainCol(domainId) {
  // Materialize default into array on first toggle
  if (!Array.isArray(state.collapsedDomains)) {
    state.collapsedDomains = [];
  }
  toggleDomainCollapsed(domainId);
  deps.save();
  deps.renderProjectBoard();
}

export function expandAllDomains() {
  setAllDomainsCollapsed(false);
  deps.save();
  deps.renderProjectBoard();
}

export function collapseAllDomains() {
  setAllDomainsCollapsed(true);
  deps.save();
  deps.renderProjectBoard();
}

export function addDomainFromForm() {
  const inp = document.getElementById('new-domain-input');
  const label = (inp && inp.value || '').trim();
  const res = addCustomDomain(label);
  if (!res.ok) {
    if (inp) { inp.focus(); inp.placeholder = res.error || 'Name required…'; }
    return;
  }
  toggleAddDomain(false);
  // Expand newly added domain
  if (Array.isArray(state.collapsedDomains)) {
    state.collapsedDomains = state.collapsedDomains.filter(id => id !== res.id);
  }
  deps.save();
  deps.renderDashboard();
}

export function dropOnDomainLane(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const id = e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain') || state.dashDragId;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.domain = e.currentTarget.dataset.domain;
  t.lane = e.currentTarget.dataset.lane;
  t.activity = e.currentTarget.dataset.lane === 'research' ? 'research' : e.currentTarget.dataset.lane;
  deps.save();
  deps.renderDashboard();
}

export function weekLnoStats() {
  const mon = (() => {
    const d = new Date();
    const day = d.getDay();
    const back = day === 0 ? 6 : day - 1;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  })();
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
    dates.push(formatYmd(x));
  }
  let total = 0, lMins = 0;
  state.tasks.forEach(t => {
    if (!t.date || !t.start || !dates.includes(t.date)) return;
    if (t.status === 'someday') return;
    const dur = t.duration || DEFAULT_DURATION;
    total += dur;
    if (t.lno === 'L') lMins += dur;
  });
  const pct = total ? Math.round((lMins / total) * 100) : 0;
  return { total, lMins, pct };
}

/** Phone: one row of tabs, Day · Domains · Needs you (the last two are the board's two views). */
export function setDashMobileScreen(screen) {
  if (screen === 'domains' || screen === 'needs') {
    state.boardView = screen;
    screen = 'board';
  }
  state.dashMobileScreen = screen === 'board' ? 'board' : 'day';
  document.body.classList.toggle('dash-show-board', state.dashMobileScreen === 'board');
  document.body.classList.toggle('dash-show-day', state.dashMobileScreen !== 'board');
  renderNeedsYou();
}

if (typeof window !== 'undefined') {
  // Folded rows are sized to the panel, so a new window size needs a new layout.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!foldNightOn()) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById('phase-dashboard')?.classList.contains('active')) renderDayCalendar();
    }, 150);
  });
}

export function renderDashboard() {
  ensureDashCalDate();
  setDashMobileScreen(state.dashMobileScreen || 'day');
  deps.renderDayCalendar();
  deps.renderProjectBoard();
  if (typeof window.renderSomedayPanel === 'function') {
    window.renderSomedayPanel(document.getElementById('someday-panel'));
  }
  renderNextUp();
  renderDelegatedPanel();
  renderErrandsPanel();
  renderNeedsYou();
}
