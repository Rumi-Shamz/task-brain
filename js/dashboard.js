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
  allDomains, normalizeDomainId, addCustomDomain, domainStyleVar,
  toggleDomainCollapsed, setAllDomainsCollapsed,
} from './domains.js';
import { getProject, ACTIVITIES } from './projects.js';
import { deps } from './deps.js';
import { blocksOnDate, allDayOnDate } from './blocks.js';
import { describeRepeat } from './recurring.js';
import { openDashEdit, renderDashEditSheet } from './dashboard-edit.js';

export * from './dashboard-drag.js';
export * from './dashboard-edit.js';

const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function minsToY(mins) { return ((mins - CAL_DAY_START) / 60) * HOUR_H; }
export function durationToH(duration) { return Math.max((duration / 60) * HOUR_H, 28); }
export function yToMins(y) { return CAL_DAY_START + (y / HOUR_H) * 60; }
export function applyCalBlockStyle(el, t) {
  const startMins = parseHHMM(t.start);
  if (startMins == null) return;
  const dur = t.duration || DEFAULT_DURATION;
  el.style.top = minsToY(startMins) + 'px';
  el.style.height = durationToH(dur) + 'px';
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

export function boardRowHTML(t, { nested = false } = {}) {
  const scheduled = !!(t.start && t.date);
  const running = !!t.timerStartedAt;
  const proj = getProject(t.projectId || t.project);
  const act = t.activity || t.lane || 'act';
  const tags = [
    `<span class="tag">${esc(activityLabel(act))}</span>`,
    proj ? `<span class="tag">${esc(proj.name)}</span>` : '',
    t.lno ? `<span class="tag">LNO ${esc(t.lno)}</span>` : '',
    scheduled ? `<span class="tag tag-sched">${esc(t.date.slice(5))} ${esc(t.start)}</span>` : '',
    !t.done && t.missed && t.missed.length
      ? `<span class="tag tag-missed" title="Missed on ${esc(t.missed.join(', '))}">slipped ×${t.missed.length}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="board-row ${nested ? 'board-row-child' : ''} ${scheduled ? 'scheduled' : ''} ${t.done ? 'done' : ''} ${running ? 'timer-running' : ''}"
      draggable="true" data-id="${t.id}"
      ondragstart="dashChipDragStart(event)" ondragend="dashChipDragEnd(event)"
      onclick="dashRowClick(event,'${t.id}')">
    <div class="board-row-main">
      <input type="checkbox" class="chip-done" ${t.done ? 'checked' : ''}
        onpointerdown="event.stopPropagation()"
        onclick="event.stopPropagation(); toggleTaskDone('${t.id}', this.checked)"
        title="Mark done" aria-label="Mark done" />
      <div class="board-row-text">
        <span class="board-row-name">${esc(t.name)}</span>
        <span class="board-row-tags">${tags}</span>
      </div>
    </div>
    <div class="board-row-controls" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">
      ${chipControlsHTML(t)}
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
  const allDay = document.getElementById('dash-day-allday');
  if (allDay) {
    const items = allDayOnDate(ymd);
    allDay.hidden = !items.length;
    allDay.innerHTML = items.map(b => `<span class="allday-chip" style="${domainStyleVar(b.domain)}">${esc(b.name)}</span>`).join('');
  }
  const hours = [];
  for (let h = 0; h < 24; h++) {
    hours.push(`<div class="day-hour" data-hour="${ h }">
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
        style="${ projectCssVars(t.project) }${ domainStyleVar(taskDomain(t)) }top:${ minsToY(startMins) }px;height:${ durationToH(dur) }px;"
        title="${ esc(t.name) } · ${ esc(t.start) }–${ esc(endLabel) }"
        onpointerdown="calBlockPointerDown(event)">
      <div class="cal-block-top">
        <input type="checkbox" class="chip-done" ${ t.done ? 'checked' : '' }
          onpointerdown="event.stopPropagation()"
          onclick="event.stopPropagation(); toggleTaskDone('${ t.id }', this.checked)" title="Mark done" aria-label="Mark done" />
        <div class="cal-block-name">${ esc(t.name) }</div>
      </div>
      <div class="cal-block-controls" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">
        ${ chipControlsHTML(t) }
      </div>
      <div class="cal-resize" data-resize="1"></div>
    </div>`;
  }).join('');
  const bands = blocksOnDate(ymd).map(b => {
    const top = minsToY(b.startMin);
    const height = durationToH(b.endMin - b.startMin);
    return `<div class="cal-protocol ${b.rule === 'event' ? 'event' : 'open'}" style="${domainStyleVar(b.domain)}top:${top}px;height:${height}px"
        title="${esc(b.name)} · ${esc(formatHHMM(b.startMin))}–${esc(formatHHMM(b.endMin))} · ${esc(describeRepeat(b))}">
      <span>${b.rule === 'event' ? `${esc(formatHHMM(b.startMin))} ` : ''}${esc(b.name)}</span>
    </div>`;
  }).join('');
  root.innerHTML = `<div class="day-hours">${ hours.join('') }</div><div class="cal-blocks">${ bands }${ blocks }</div>`;
  if (state.dayCalScrolledOnce) root.scrollTop = prevScroll;
  else { root.scrollTop = VIEW_SCROLL_TOP; state.dayCalScrolledOnce = true; }
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
  // Default: collapse empty domains
  return !domainHasTasks(domainId);
}

function matchesActivityFilter(t) {
  const f = state.dashActivityFilter || 'all';
  if (f === 'all') return true;
  const act = t.activity || t.lane || 'act';
  if (f === 'learn') return act === 'learn';
  if (f === 'research') return act === 'research';
  return act === f;
}

export function renderProjectBoard() {
  const board = document.getElementById('project-board');
  if (!board) return;
  const visible = (list) => state.hideDone ? list.filter(t => !t.done) : list;
  const activities = ACTIVITIES.length ? ACTIVITIES : LANES;
  const domains = allDomains();
  const collapsedDoms = domains.filter(d => isCollapsed(d.id));
  const expandedDoms = domains.filter(d => !isCollapsed(d.id));
  const filter = state.dashActivityFilter || 'all';

  const strip = document.getElementById('domain-chip-strip');
  if (strip) {
    if (!collapsedDoms.length) {
      strip.hidden = true;
      strip.innerHTML = '';
    } else {
      strip.hidden = false;
      strip.innerHTML = collapsedDoms.map(dom => {
        const count = visible(state.tasks.filter(t => t.status !== 'someday' && isTopLevelTask(t) && taskDomain(t) === dom.id)).length;
        return `<button type="button" class="domain-chip" data-domain="${dom.id}" style="${domainStyleVar(dom.id)}"
            onclick="toggleDomainCol('${dom.id}')" title="Expand ${esc(dom.label)}">
          <span class="project-dot"></span>
          <span class="domain-chip-label">${esc(dom.label)}</span>
          <span class="domain-count">${count}</span>
          <span class="domain-chevron">▸</span>
        </button>`;
      }).join('');
    }
  }

  const filterChips = `<div class="board-activity-filters">
    <button type="button" class="btn ${filter === 'all' ? 'primary' : ''}" onclick="setDashActivityFilter('all')">All</button>
    ${activities.map(a =>
      `<button type="button" class="btn ${filter === a.id ? 'primary' : ''}" onclick="setDashActivityFilter('${a.id}')">${esc(a.label.split(' ')[0])}</button>`
    ).join('')}
  </div>`;

  const domainStacks = expandedDoms.map(dom => {
    const roots = visible(state.tasks.filter(t =>
      t.status !== 'someday' && isTopLevelTask(t) && taskDomain(t) === dom.id
    ));
    const count = roots.filter(matchesActivityFilter).length;
    const sections = activities.map(a => {
      const inSection = roots.filter(t => (t.activity || t.lane || 'act') === a.id && matchesActivityFilter(t));
      const rows = inSection.map(t => {
        const kids = visible(childTasksOf(t.id).filter(c => (c.activity || c.lane || 'act') === a.id && matchesActivityFilter(c)));
        return boardRowHTML(t) + kids.map(c => boardRowHTML(c, { nested: true })).join('');
      }).join('');
      return `<section class="domain-activity">
        <div class="domain-activity-label">${esc(a.label)}</div>
        <div class="domain-task-rows">${rows || '<div class="dash-inbox-empty">None</div>'}</div>
      </section>`;
    }).join('');
    return `<div class="project-col domain-col domain-stack" data-domain="${dom.id}" style="${domainStyleVar(dom.id)}"
        ondragover="boardDragOver(event)" ondragleave="boardDragLeave(event)"
        ondrop="dropOnDomainStack(event)">
      <button type="button" class="project-col-header domain-toggle" onclick="toggleDomainCol('${dom.id}')">
        <span class="project-dot"></span>
        <span class="domain-toggle-label">${esc(dom.label)}</span>
        <span class="domain-count">${count}</span>
        <span class="domain-chevron">▾</span>
      </button>
      ${sections}
    </div>`;
  }).join('') || '<div class="dash-inbox-empty">All domains collapsed — click a chip above to expand one.</div>';

  board.innerHTML = filterChips + domainStacks;

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
    state.collapsedDomains = allDomains().filter(d => !domainHasTasks(d.id)).map(d => d.id);
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
  if (inp) { inp.value = ''; inp.placeholder = 'New domain…'; }
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

export function setDashMobileScreen(screen) {
  state.dashMobileScreen = screen === 'board' ? 'board' : 'day';
  document.body.classList.toggle('dash-show-board', state.dashMobileScreen === 'board');
  document.body.classList.toggle('dash-show-day', state.dashMobileScreen !== 'board');
  const dayTab = document.getElementById('dash-tab-day');
  const boardTab = document.getElementById('dash-tab-board');
  if (dayTab) dayTab.classList.toggle('active', state.dashMobileScreen === 'day');
  if (boardTab) boardTab.classList.toggle('active', state.dashMobileScreen === 'board');
}

export function renderDashboard() {
  ensureDashCalDate();
  setDashMobileScreen(state.dashMobileScreen || 'day');
  deps.renderDayCalendar();
  deps.renderProjectBoard();
  if (typeof window.renderSomedayPanel === 'function') {
    window.renderSomedayPanel(document.getElementById('someday-panel'));
  }
  if (typeof window.renderSlippedPanel === 'function') {
    window.renderSlippedPanel(document.getElementById('slipped-panel'));
    const n = document.querySelectorAll('#slipped-panel .someday-card').length;
    const sum = document.getElementById('slipped-summary');
    if (sum) sum.textContent = n ? `Slipped (${n})` : 'Slipped';
  }
}
