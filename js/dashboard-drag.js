/** Today + Year week: drag tasks between board, inbox and calendars; move/resize calendar blocks. */
import {
  state, HOUR_H, DAY_START_MIN, DAY_END_MIN, VISIBLE_MINUTES, DEFAULT_DURATION,
  CAL_DAY_START, CAL_DAY_END, CAL_MIN_DURATION, projectClass, projectCssVars,
  esc, parseHHMM, formatHHMM, snapCalMins, clampCalStart, ensureDashCalDate, toggleTaskDone,
} from './state.js';
import { deps } from './deps.js';
import {
  applyCalBlockStyle, dropOnDomainLane, minsToY, yToMins, openDashEdit, renderDashboard,
} from './dashboard.js';

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
  t.start = null; t.date = null; t.interval = null; t.blockId = null; t.replacesBlockId = null;
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
        style="${ projectCssVars(t.project) }top:${ top }px;height:${ Math.max(height, 28) }px"
        title="${ esc(t.name) } · ${ esc(t.start) }–${ esc(endLabel) } (${ dur }m) · double-click to unschedule"
        onpointerdown="weekTaskPointerDown(event)"
        ondblclick="event.stopPropagation();unscheduleTask('${ t.id }');renderYear();">
      <div class="yt-head">
        <input type="checkbox" class="chip-done" ${ t.done ? 'checked' : '' }
          onpointerdown="event.stopPropagation()"
          onclick="event.stopPropagation(); toggleTaskDone('${ t.id }', this.checked)" title="Mark done" aria-label="Mark done" />
        <div class="yt-name">${ esc(t.name) }</div>
      </div>
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


