import {
  state, LANES, HOUR_H, VIEW_HOUR_START, VIEW_HOUR_END, VIEW_HOURS, VIEW_SCROLL_TOP,
  DAY_START_MIN, DAY_END_MIN, VISIBLE_MINUTES, DEFAULT_DURATION, CAL_DAY_START, CAL_DAY_END,
  CAL_SNAP, CAL_MIN_DURATION, allProjects, projectClass, projectCssVars, projectColStyleAttr, chipControlsHTML,
  esc, pad2, formatYmd, parseYmd, parseHHMM, formatHHMM, snapCalMins, clampCalStart, todayYmd,
  ensureDashCalDate, formatTracked, taskElapsedMs, setHideDone, toggleTaskDone,
  startTaskTimer, pauseTaskTimer, stopTaskTimer, ensureTimerTick
} from './state.js';
import { deps } from './deps.js';

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
  const scheduled = !!(t.start && t.date);
  const running = !!t.timerStartedAt;
  return `<div class="board-chip ${ scheduled ? 'scheduled' : '' } ${ t.done ? 'done' : '' } ${ running ? 'timer-running' : '' }"
      draggable="true" data-id="${ t.id }"
      ondragstart="dashChipDragStart(event)" ondragend="dashChipDragEnd(event)">
    <div class="board-chip-main">
      <input type="checkbox" class="chip-done" ${ t.done ? 'checked' : '' }
        onpointerdown="event.stopPropagation()"
        onclick="event.stopPropagation(); toggleTaskDone('${ t.id }', this.checked)"
        title="Mark done" aria-label="Mark done" />
      <span class="board-chip-name">${ esc(t.name) }</span>
      ${scheduled ? `<span class="chip-sched-mark">${ esc(t.date.slice(5)) } ${ esc(t.start) }</span>` : ''}
    </div>
    ${ chipControlsHTML(t) }
  </div>`;
}

export function renderDayCalendar() {
  const root = document.getElementById('day-calendar');
  if (!root) return;
  const prevScroll = root.scrollTop;
  const ymd = ensureDashCalDate();
  const title = document.getElementById('dash-day-title');
  if (title) title.textContent = ymd + ' · viewport 06:00–22:00 (scroll for full day)';
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
  root.innerHTML = `<div class="day-hours">${ hours.join('') }</div><div class="cal-blocks">${ blocks }</div>`;
  if (state.dayCalScrolledOnce) root.scrollTop = prevScroll;
  else { root.scrollTop = VIEW_SCROLL_TOP; state.dayCalScrolledOnce = true; }
}

export function renderProjectBoard() {
  const board = document.getElementById('project-board');
  if (!board) return;
  const visible = (list) => state.hideDone ? list.filter(t => !t.done) : list;
  board.innerHTML = allProjects().map(p => {
    const lanes = LANES.map(lane => {
      const chips = visible(state.tasks.filter(t => t.project === p.id && t.lane === lane.id));
      return `<div class="lane-block" data-project="${ p.id }" data-lane="${ lane.id }"
          ondragover="boardDragOver(event)" ondragleave="boardDragLeave(event)" ondrop="dropOnLane(event)">
        <div class="lane-label">${ esc(lane.label) }</div>
        <div class="lane-chips">${ chips.map(chipHTML).join('') }</div>
      </div>`;
    }).join('');
    return `<div class="project-col" data-project="${ p.id }"${ projectColStyleAttr(p.id) }>
      <div class="project-col-header"><span class="project-dot"></span>${ esc(p.label) }</div>
      ${ lanes }
    </div>`;
  }).join('');
  const inbox = visible(state.tasks.filter(t => !t.project));
  const inboxEl = document.getElementById('dash-inbox-chips');
  if (inboxEl) { inboxEl.innerHTML = inbox.length
      ? inbox.map(chipHTML).join('')
      : '<div class="dash-inbox-empty">Tasks without a project land here. Drag onto a lane to assign, or onto the day calendar to schedule.</div>'; }
  const toggle = document.getElementById('hide-done-toggle');
  if (toggle) toggle.checked = state.hideDone;
  ensureTimerTick();
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

export function renderDashboard() {
  ensureDashCalDate();
  deps.renderDayCalendar();
  deps.renderProjectBoard();
  const el = document.getElementById('lno-week-stat');
  if (el) {
    const s = weekLnoStats();
    el.textContent = s.total
      ? `This week: ${s.pct}% of scheduled minutes on L (${s.lMins}m / ${s.total}m)`
      : 'This week: no scheduled minutes yet — tag tasks L/N/O in Triage.';
  }
  if (typeof window.renderSkillsPanel === 'function') {
    window.renderSkillsPanel(document.getElementById('skills-panel'));
  }
  if (typeof window.renderSomedayPanel === 'function') {
    window.renderSomedayPanel(document.getElementById('someday-panel'));
  }
}

export function dashChipDragStart(e) {
  if (e.target.closest('input, button, .chip-actions, .cal-block-controls')) { e.preventDefault();
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
  let changed = moved || mode === 'resize';
  clearLanePointerOver();
  block.style.pointerEvents = '';
  if (mode === 'move' && t) {
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const lane = under && under.closest('.lane-block');
    const inbox = under && under.closest('.dash-inbox');
    if (lane) { t.project = lane.dataset.project;
      t.lane = lane.dataset.lane;
      t.start = null; t.date = null;
      changed = true; } else if (inbox) { t.project = null; t.lane = null;
      t.start = null; t.date = null;
      changed = true; }
  }
  block.classList.remove('moving', 'resizing');
  state.calPointer = null;
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
    const top = ((Math.max(startMins, DAY_START_MIN) - DAY_START_MIN) / VISIBLE_MINUTES) * 100;
    const height = ((Math.min(endMins, DAY_END_MIN) - Math.max(startMins, DAY_START_MIN)) / VISIBLE_MINUTES) * 100;
    const endLabel = formatHHMM(startMins + dur);
    return `<div class="year-task-block ${ projectClass(t.project) } ${ t.done ? 'done' : '' }" data-task-id="${ t.id }" data-ymd="${ esc(ymd) }"
        style="${ projectCssVars(t.project) }top:${ top }%;height:${ Math.max(height, 3.5) }%"
        title="${ esc(t.name) } · ${ esc(t.start) }–${ esc(endLabel) } (${ dur }m) · double-click to unschedule"
        onpointerdown="weekTaskPointerDown(event)"
        ondblclick="event.stopPropagation();unscheduleTask('${ t.id }');deps.renderYear();">
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
  const yRatio = (startMins - DAY_START_MIN) / VISIBLE_MINUTES;
  state.calPointer = { id, mode: 'move', source: 'week', startX: e.clientX, startY: e.clientY, origStart: startMins, origDuration: t.duration || DEFAULT_DURATION, grabOffset: e.clientY - (colRect.top + yRatio * colRect.height), moved: false, block, ymd: block.dataset.ymd };
  block.classList.add('moving');
  e.preventDefault();
}
export function onWeekTaskPointerMove(e, t) {
  if (Math.abs(e.clientY - state.calPointer.startY) > 3) state.calPointer.moved = true;
  const col = document.querySelector(`.year-week-col[data-ymd="${ state.calPointer.ymd }"]`);
  if (!col) return;
  const rect = col.getBoundingClientRect();
  const grabRatio = (state.calPointer.origStart - DAY_START_MIN) / VISIBLE_MINUTES;
  const grabPx = grabRatio * rect.height;
  const offset = state.calPointer.startY - (rect.top + grabPx);
  const newTop = e.clientY - rect.top - offset;
  const ratio = rect.height > 0 ? Math.max(0, Math.min(1, newTop / rect.height)) : 0;
  const mins = clampCalStart(snapCalMins(DAY_START_MIN + ratio * VISIBLE_MINUTES), t.duration || DEFAULT_DURATION);
  t.start = formatHHMM(mins);
  const dur = t.duration || DEFAULT_DURATION;
  const endMins = Math.min(DAY_END_MIN, mins + dur);
  const block = state.calPointer.block;
  block.style.top = ((mins - DAY_START_MIN) / VISIBLE_MINUTES) * 100 + '%';
  block.style.height = ((endMins - mins) / VISIBLE_MINUTES) * 100 + '%';
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


