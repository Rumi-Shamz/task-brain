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
  allDomains, normalizeDomainId, addCustomDomain,
  toggleDomainCollapsed, setAllDomainsCollapsed,
} from './domains.js';
import { getProject, ACTIVITIES, projectsInDomain, ensureProjectForDomain } from './projects.js';
import { deps } from './deps.js';
import {
  blocksOnDate, placementsFor, applyPlacement, currentPlacementId, isTaskDay,
} from './blocks.js';

const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function minsToY(mins) { return ((mins - CAL_DAY_START) / 60) * HOUR_H; }
export function durationToH(duration) { return Math.max((duration / 60) * HOUR_H, 18); }
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

export function openDashEdit(id) {
  state.dashEditId = id;
  renderDashEditSheet();
}

export function closeDashEdit() {
  state.dashEditId = null;
  const el = document.getElementById('dash-edit-sheet');
  if (el) el.remove();
}

export function saveDashEdit() {
  const t = state.tasks.find(x => x.id === state.dashEditId);
  if (!t) { closeDashEdit(); return; }
  const name = document.getElementById('de-name')?.value.trim();
  if (name) t.name = name;
  const dom = normalizeDomainId(document.getElementById('de-domain')?.value) || t.domain || 'Personal';
  t.domain = dom;
  const projRaw = (document.getElementById('de-project')?.value || '').trim();
  if (projRaw) {
    const existing = projectsInDomain(dom).find(p => p.id === projRaw || p.name.toLowerCase() === projRaw.toLowerCase());
    const pid = existing ? existing.id : ensureProjectForDomain(dom, projRaw);
    t.project = pid;
    t.projectId = pid;
  }
  const act = document.getElementById('de-activity')?.value || 'act';
  t.activity = act;
  t.lane = act === 'research' ? 'research' : act;
  t.note = (document.getElementById('de-note')?.value || '').trim();
  t.done = !!document.getElementById('de-done')?.checked;
  const ymd = document.getElementById('de-ymd')?.value || '';
  const place = document.getElementById('de-place')?.value || '';
  const free = document.getElementById('de-free-start')?.value || t.start || '09:00';
  const dur = parseInt(document.getElementById('de-duration')?.value || '', 10);
  if (Number.isFinite(dur) && dur > 0) t.duration = dur;
  if (!place || !ymd) {
    t.date = null;
    t.start = null;
    t.blockId = null;
    t.replacesBlockId = null;
  } else {
    applyPlacement(t, ymd, place, free);
    state.dashCalDate = ymd;
  }
  deps.save();
  closeDashEdit();
  deps.renderDashboard();
}

export function renderDashEditSheet() {
  let el = document.getElementById('dash-edit-sheet');
  if (!state.dashEditId) {
    if (el) el.remove();
    return;
  }
  const t = state.tasks.find(x => x.id === state.dashEditId);
  if (!t) { closeDashEdit(); return; }
  const domain = normalizeDomainId(t.domain) || 'Personal';
  const projects = projectsInDomain(domain);
  const pid = t.projectId || t.project || '';
  const act = t.activity || t.lane || 'act';
  const scheduled = !!(t.date && t.start);
  const schedMode = scheduled ? 'exact' : 'none';
  if (!el) {
    el = document.createElement('div');
    el.id = 'dash-edit-sheet';
    document.body.appendChild(el);
  }
  el.className = 'dash-edit-sheet';
  el.innerHTML = `
    <div class="dash-edit-backdrop" onclick="closeDashEdit()"></div>
    <div class="dash-edit-panel" role="dialog" aria-label="Edit task">
      <div class="dash-edit-head">
        <strong>Edit task</strong>
        <button type="button" class="btn" onclick="closeDashEdit()">Close</button>
      </div>
      <label class="plan-field">Name
        <input type="text" id="de-name" value="${esc(t.name)}" />
      </label>
      <div class="plan-row plan-row-2">
        <label class="plan-field">Domain
          <select id="de-domain">${allDomains().map(d =>
            `<option value="${d.id}" ${d.id === domain ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}
          </select>
        </label>
        <label class="plan-field">Project
          <select id="de-project">
            <option value="">—</option>
            ${projects.map(p => `<option value="${p.id}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="plan-field">Activity
        <select id="de-activity">${ACTIVITIES.map(a =>
          `<option value="${a.id}" ${a.id === act ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
        </select>
      </label>
      <div class="plan-field">Schedule
        ${dashPlacementHTML(t)}
      </div>
      <label class="plan-field">Note
        <textarea id="de-note" rows="3">${esc(t.note || '')}</textarea>
      </label>
      <label class="dash-edit-done"><input type="checkbox" id="de-done" ${t.done ? 'checked' : ''} /> Done</label>
      <div class="plan-step-actions">
        <button type="button" class="btn primary" onclick="saveDashEdit()">Save</button>
        <button type="button" class="btn" onclick="closeDashEdit()">Cancel</button>
      </div>
    </div>`;
}

export function dashEditDayChanged() {
  const t = state.tasks.find(x => x.id === state.dashEditId);
  const ymd = document.getElementById('de-ymd')?.value || '';
  const box = document.getElementById('de-place');
  if (!t || !box) return;
  const opts = ymd ? placementsFor({ ...t, date: ymd }, ymd) : [];
  const cur = t.date === ymd ? currentPlacementId(t) : '';
  box.innerHTML = `<option value="">Leave open</option>` + opts.map(o =>
    `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');
  const free = document.getElementById('de-free-wrap');
  if (free) free.style.display = cur === 'free' ? '' : 'none';
}

function dashPlacementHTML(t) {
  const ymd = t.date || ensureDashCalDate();
  const opts = placementsFor(t, ymd);
  const cur = t.date ? currentPlacementId(t) : '';
  const open = isTaskDay(ymd);
  return `<div class="plan-pair">
    <label class="plan-field">Day
      <input type="date" id="de-ymd" value="${esc(ymd)}" onchange="dashEditDayChanged()" />
    </label>
    <label class="plan-field">Place
      <select id="de-place" onchange="document.getElementById('de-free-wrap').style.display=this.value==='free'?'':'none'">
        <option value="">Leave open</option>
        ${open ? opts.map(o => `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('') : ''}
      </select>
    </label>
    <label class="plan-field" id="de-free-wrap" style="${cur === 'free' ? '' : 'display:none'}">Start
      <input type="time" id="de-free-start" value="${esc(t.start || '09:00')}" />
    </label>
    <label class="plan-field">Duration
      <select id="de-duration">
        ${[15, 30, 60, 180].map(n => `<option value="${n}" ${Number(t.duration) === n ? 'selected' : ''}>${n} min</option>`).join('')}
      </select>
    </label>
  </div>${open ? '' : '<p class="bulk-hint">That day is not a work or sprint day. Pick another day, or leave it open.</p>'}`;
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
        style="${ projectCssVars(t.project) }top:${ minsToY(startMins) }px;height:${ durationToH(dur) }px;"
        onpointerdown="calBlockPointerDown(event)">
      <div class="cal-block-top">
        <input type="checkbox" class="chip-done" ${ t.done ? 'checked' : '' }
          onpointerdown="event.stopPropagation()"
          onclick="event.stopPropagation(); toggleTaskDone('${ t.id }', this.checked)" title="Mark done" aria-label="Mark done" />
        <div class="cal-block-time">${ esc(t.start) }–${ esc(endLabel) }</div>
      </div>
      <div class="cal-block-name">${ esc(t.name) }</div>
      <div class="cal-block-controls" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">
        ${ chipControlsHTML(t) }
      </div>
      <div class="cal-resize" data-resize="1"></div>
    </div>`;
  }).join('');
  const bands = blocksOnDate(ymd).map(b => {
    const top = minsToY(b.startMin);
    const height = durationToH(b.endMin - b.startMin);
    return `<div class="cal-protocol ${b.rule === 'event' ? 'event' : 'open'}" style="top:${top}px;height:${height}px" title="${esc(b.name)}">
      <span>${esc(b.name)}</span>
    </div>`;
  }).join('');
  root.innerHTML = `<div class="day-hours">${ hours.join('') }</div><div class="cal-blocks">${ bands }${ blocks }</div>`;
  if (state.dayCalScrolledOnce) root.scrollTop = prevScroll;
  else { root.scrollTop = VIEW_SCROLL_TOP; state.dayCalScrolledOnce = true; }
}

function taskDomain(t) {
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
        return `<button type="button" class="domain-chip" data-domain="${dom.id}"
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
      t.status !== 'someday' && isTopLevelTask(t) && taskDomain(t) === dom.id && matchesActivityFilter(t)
    ));
    const count = roots.length;
    const rows = roots.map(t => {
      const kids = visible(childTasksOf(t.id).filter(matchesActivityFilter));
      return boardRowHTML(t) + kids.map(c => boardRowHTML(c, { nested: true })).join('');
    }).join('');
    return `<div class="project-col domain-col domain-stack" data-domain="${dom.id}"
        ondragover="boardDragOver(event)" ondragleave="boardDragLeave(event)"
        ondrop="dropOnDomainStack(event)">
      <button type="button" class="project-col-header domain-toggle" onclick="toggleDomainCol('${dom.id}')">
        <span class="project-dot"></span>
        <span class="domain-toggle-label">${esc(dom.label)}</span>
        <span class="domain-count">${count}</span>
        <span class="domain-chevron">▾</span>
      </button>
      <div class="domain-task-rows">${rows || '<div class="dash-inbox-empty">No tasks in this filter.</div>'}</div>
    </div>`;
  }).join('') || '<div class="dash-inbox-empty">All domains collapsed — click a chip above to expand one.</div>';

  let grouped = '';
  if (filter !== 'all') {
    const rows = visible(state.tasks.filter(t =>
      t.status !== 'someday' && isTopLevelTask(t) && matchesActivityFilter(t)
    ));
    grouped = `<div class="domain-task-rows">${rows.length
      ? rows.map(t => boardRowHTML(t) + visible(childTasksOf(t.id).filter(matchesActivityFilter)).map(c => boardRowHTML(c, { nested: true })).join('')).join('')
      : '<div class="dash-inbox-empty">No tasks in this group.</div>'}</div>`;
  }
  board.innerHTML = filterChips + (filter === 'all' ? domainStacks : grouped);

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
}

export function dashChipDragStart(e) {
  if (e.target.closest('input, button, .chip-actions, .cal-block-controls, .board-row-controls')) { e.preventDefault();
    return; }
  const id = e.currentTarget.dataset.id;
  state.dashDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.setData('application/x-task-id', id);
}
export function dashChipDragEnd() { state.dashDragId = null;
  document.querySelectorAll('.day-hour.drop-hover').forEach(el => el.classList.remove('drop-hover'));
  document.querySelectorAll('.lane-block.drag-over, .dash-inbox.drag-over, .year-week-col.task-drop-hover').forEach(el => el.classList.remove('drag-over', 'task-drop-hover')); }
export function boardDragOver(e) { e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over'); }
export function boardDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('drag-over');
}
export function dropOnLane(e) {
  if (e.currentTarget.dataset.domain) return dropOnDomainLane(e);
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const id = e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain') || state.dashDragId;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.project = e.currentTarget.dataset.project;
  t.lane = e.currentTarget.dataset.lane;
  deps.save();
  deps.renderDashboard();
}
export function dropOnInbox(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const id = e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain') || state.dashDragId;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.project = null;
  t.lane = null;
  deps.save();
  deps.renderDashboard();
}
export function calSlotDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const hourEl = e.currentTarget.closest('.day-hour');
  document.querySelectorAll('.day-hour.drop-hover').forEach(el => { if (el !== hourEl) el.classList.remove('drop-hover'); });
  if (hourEl) hourEl.classList.add('drop-hover');
}
export function calSlotDragLeave(e) {
  const hourEl = e.currentTarget.closest('.day-hour');
  if (hourEl && !hourEl.contains(e.relatedTarget)) hourEl.classList.remove('drop-hover');
}
export function calSlotDrop(e, hour) {
  e.preventDefault();
  const hourEl = e.currentTarget.closest('.day-hour');
  if (hourEl) hourEl.classList.remove('drop-hover');
  const id = e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain') || state.dashDragId;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const half = (e.clientY - rect.top) > rect.height / 2 ? 30 : 0;
  if (!t.duration) t.duration = DEFAULT_DURATION;
  const startMins = clampCalStart(snapCalMins(hour * 60 + half), t.duration);
  t.start = formatHHMM(startMins);
  t.date = ensureDashCalDate();
  deps.save();
  deps.renderDashboard();
}
export function clearLanePointerOver() { document.querySelectorAll('.lane-block.pointer-over, .dash-inbox.pointer-over').forEach(el => el.classList.remove('pointer-over')); }
export function calBlockPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('input, button, .chip-actions, .cal-block-controls')) return;
  const block = e.currentTarget;
  const id = block.dataset.id;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const isResize = !!e.target.closest('[data-resize]');
  const cal = document.getElementById('day-calendar');
  const calRect = cal.getBoundingClientRect();
  const startMins = parseHHMM(t.start) ?? CAL_DAY_START;
  const contentY = minsToY(startMins) - cal.scrollTop;
  state.calPointer = { id, mode: isResize ? 'resize' : 'move', startX: e.clientX, startY: e.clientY, origStart: startMins, origDuration: t.duration || DEFAULT_DURATION, grabOffset: e.clientY - (calRect.top + contentY), moved: false, block, pointerId: e.pointerId, source: 'dash' };
  block.classList.add(isResize ? 'resizing' : 'moving');
  if (!isResize) block.style.pointerEvents = 'none';
  e.preventDefault();
}
export function onCalPointerMove(e) {
  if (!state.calPointer) return;
  const t = state.tasks.find(x => x.id === state.calPointer.id);
  if (!t) return;
  if (state.calPointer.source === 'week') { onWeekTaskPointerMove(e, t);
    return; }
  const cal = document.getElementById('day-calendar');
  if (!cal) return;
  const calRect = cal.getBoundingClientRect();
  if (Math.abs(e.clientY - state.calPointer.startY) > 3 || Math.abs(e.clientX - (state.calPointer.startX || e.clientX)) > 3) state.calPointer.moved = true;
  if (state.calPointer.mode === 'move') {
    const topPx = e.clientY - calRect.top + cal.scrollTop - state.calPointer.grabOffset;
    const mins = clampCalStart(snapCalMins(yToMins(topPx)), t.duration || DEFAULT_DURATION);
    t.start = formatHHMM(mins);
    applyCalBlockStyle(state.calPointer.block, t);
    clearLanePointerOver();
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const zone = under && under.closest('.lane-block, .dash-inbox');
    if (zone) zone.classList.add('pointer-over');
  } else {
    const bottomMins = yToMins(e.clientY - calRect.top + cal.scrollTop);
    let dur = snapCalMins(bottomMins - state.calPointer.origStart);
    const maxDur = CAL_DAY_END - state.calPointer.origStart;
    dur = Math.max(CAL_MIN_DURATION, Math.min(maxDur, dur));
    t.duration = dur;
    applyCalBlockStyle(state.calPointer.block, t);
  }
}
export function onCalPointerUp(e) {
  if (!state.calPointer) return;
  if (state.calPointer.source === 'week') { onWeekTaskPointerUp(e);
    return; }
  const t = state.tasks.find(x => x.id === state.calPointer.id);
  const block = state.calPointer.block;
  const mode = state.calPointer.mode;
  const moved = state.calPointer.moved;
  const editId = state.calPointer.id;
  let changed = moved || mode === 'resize';
  clearLanePointerOver();
  block.style.pointerEvents = '';
  if (mode === 'move' && t) {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const lane = under && under.closest('.lane-block, .domain-stack');
    const inbox = under && under.closest('.dash-inbox');
    if (lane) {
      if (lane.dataset.domain) t.domain = lane.dataset.domain;
      if (lane.dataset.project) t.project = lane.dataset.project;
      if (lane.dataset.lane) {
        t.lane = lane.dataset.lane;
        t.activity = lane.dataset.lane === 'research' ? 'research' : lane.dataset.lane;
      }
      t.start = null; t.date = null;
      changed = true;
    } else if (inbox) {
      t.project = null; t.lane = null;
      t.start = null; t.date = null;
      changed = true;
    }
  }
  block.classList.remove('moving', 'resizing');
  state.calPointer = null;
  if (!changed && mode === 'move' && editId) {
    openDashEdit(editId);
    return;
  }
  if (changed) { deps.save(); deps.renderDashboard(); }
}
document.addEventListener('pointermove', onCalPointerMove);
document.addEventListener('pointerup', onCalPointerUp);
document.addEventListener('pointercancel', onCalPointerUp);

export function scheduleTaskOnDate(taskId, ymd, startMin) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  if (!t.duration) t.duration = DEFAULT_DURATION;
  const start = clampCalStart(snapCalMins(startMin), t.duration);
  t.date = ymd;
  t.start = formatHHMM(start);
  deps.save();
}
export function unscheduleTask(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.start = null; t.date = null;
  deps.save();
}

export function weekTaskTrayHTML(weekDates) {
  const unscheduled = state.tasks.filter(t => !(t.date && t.start));
  const chips = unscheduled.length
    ? unscheduled.map(t => `<div class="board-chip" draggable="true" data-id="${ t.id }"
        ondragstart="dashChipDragStart(event)" ondragend="dashChipDragEnd(event)">
        <span class="board-chip-name">${ esc(t.name) }</span>
      </div>`).join('')
    : '<span class="dash-inbox-empty">All tasks are on the calendar — drag from Dashboard inbox/lanes too.</span>';
  return `<div class="section-label" style="margin-bottom:6px;">Tasks — drag onto a day column to schedule</div>
    <div class="year-task-tray" id="year-task-tray">${ chips }</div>`;
}

export function weekTaskBlocksHTML(ymd) {
  return state.tasks.filter(t => t.date === ymd && t.start && !(state.hideDone && t.done)).map(t => {
    const startMins = parseHHMM(t.start);
    if (startMins == null) return '';
    const dur = t.duration || DEFAULT_DURATION;
    const endMins = Math.min(CAL_DAY_END, startMins + dur);
    const top = Math.max(startMins, DAY_START_MIN) / 60 * HOUR_H;
    const height = Math.max(0, (Math.min(endMins, DAY_END_MIN) - Math.max(startMins, DAY_START_MIN)) / 60 * HOUR_H);
    const endLabel = formatHHMM(startMins + dur);
    return `<div class="year-task-block ${ projectClass(t.project) } ${ t.done ? 'done' : '' }" data-task-id="${ t.id }" data-ymd="${ esc(ymd) }"
        style="${ projectCssVars(t.project) }top:${ top }px;height:${ Math.max(height, 18) }px"
        title="${ esc(t.name) } · ${ esc(t.start) }–${ esc(endLabel) } (${ dur }m) · double-click to unschedule"
        onpointerdown="weekTaskPointerDown(event)"
        ondblclick="event.stopPropagation();unscheduleTask('${ t.id }');renderYear();">
      <div class="yt-head">
        <input type="checkbox" class="chip-done" ${ t.done ? 'checked' : '' }
          onpointerdown="event.stopPropagation()"
          onclick="event.stopPropagation(); toggleTaskDone('${ t.id }', this.checked)" title="Mark done" aria-label="Mark done" />
        <div class="yt-time">${ esc(t.start) }–${ esc(endLabel) }</div>
      </div>
      <div class="yt-name">${ esc(t.name) }</div>
    </div>`;
  }).join('');
}

export function yearWeekColDragAttrs(ymd) {
  return `ondragover="yearWeekTaskDragOver(event)" ondragleave="yearWeekTaskDragLeave(event)" ondrop="yearWeekTaskDrop(event, '${ ymd }')"`;
}
export function yearWeekTaskDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const col = e.currentTarget;
  document.querySelectorAll('.year-week-col.task-drop-hover').forEach(el => { if (el !== col) el.classList.remove('task-drop-hover'); });
  col.classList.add('task-drop-hover');
}
export function yearWeekTaskDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('task-drop-hover');
}
export function yearWeekTaskDrop(e, ymd) {
  e.preventDefault();
  e.currentTarget.classList.remove('task-drop-hover');
  const id = e.dataTransfer.getData('application/x-task-id') || e.dataTransfer.getData('text/plain') || state.dashDragId;
  if (!id || !ymd) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
  const ratio = rect.height > 0 ? y / rect.height : 0;
  const startMin = snapCalMins(DAY_START_MIN + ratio * VISIBLE_MINUTES);
  scheduleTaskOnDate(id, ymd, startMin);
  deps.renderYear();
}
export function weekTaskPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('input, button')) return;
  e.stopPropagation();
  const block = e.currentTarget;
  const id = block.dataset.taskId;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const col = block.closest('.year-week-col');
  const startMins = parseHHMM(t.start) ?? DAY_START_MIN;
  const colRect = col.getBoundingClientRect();
  const colH = 24 * HOUR_H;
  const scale = colRect.height / colH;
  const startY = (startMins / 60) * HOUR_H * scale;
  state.calPointer = {
    id, mode: 'move', source: 'week', startX: e.clientX, startY: e.clientY,
    origStart: startMins, origDuration: t.duration || DEFAULT_DURATION,
    grabOffset: e.clientY - (colRect.top + startY),
    moved: false, block, ymd: block.dataset.ymd,
  };
  block.classList.add('moving');
  e.preventDefault();
}
export function onWeekTaskPointerMove(e, t) {
  if (Math.abs(e.clientY - state.calPointer.startY) > 3) state.calPointer.moved = true;
  const col = document.querySelector(`.year-week-col[data-ymd="${ state.calPointer.ymd }"]`);
  if (!col) return;
  const rect = col.getBoundingClientRect();
  const colH = 24 * HOUR_H;
  const scale = rect.height / colH;
  const grabPx = (state.calPointer.origStart / 60) * HOUR_H * scale;
  const offset = state.calPointer.startY - (rect.top + grabPx);
  const newTopPx = (e.clientY - rect.top - offset) / scale;
  const mins = clampCalStart(snapCalMins(newTopPx / HOUR_H * 60), t.duration || DEFAULT_DURATION);
  t.start = formatHHMM(mins);
  const dur = t.duration || DEFAULT_DURATION;
  const endMins = Math.min(DAY_END_MIN, mins + dur);
  const block = state.calPointer.block;
  block.style.top = (mins / 60) * HOUR_H + 'px';
  block.style.height = Math.max(18, ((endMins - mins) / 60) * HOUR_H) + 'px';
  const timeEl = block.querySelector('.yt-time');
  if (timeEl) timeEl.textContent = t.start + '–' + formatHHMM(mins + dur);
}
export function onWeekTaskPointerUp(e) {
  const moved = state.calPointer && state.calPointer.moved;
  const block = state.calPointer && state.calPointer.block;
  if (block) block.classList.remove('moving');
  state.calPointer = null;
  if (moved) { deps.save(); deps.renderYear(); }
}


