/** Year week view: logged hour blocks (drag to create, edit label, nudge edges). */
import {
  DAY_END_MIN, DAY_START_MIN, HOUR_H, SLOT_MINUTES, VISIBLE_MINUTES, clampVisibleMin, esc,
  formatClock, hoursBetween, newHourLogId, snapMin, state,
} from './state.js';
import { deps } from './deps.js';
import { renderYear } from './year.js';

export function upsertYearHourLog(log) { state.yearHourLogs = state.yearHourLogs.filter(l => l.id !== log.id).concat([log])
    .sort((a, b) => a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date));
  deps.save(); }

export function deleteYearHourLog(id) {
  state.yearHourLogs = state.yearHourLogs.filter(l => l.id !== id);
  if (state.yearSelectedLogId === id) state.yearSelectedLogId = null;
  deps.save();
  deps.renderYear();
}

export function selectYearHourLog(id) { state.yearSelectedLogId = id;
  deps.renderYear(); }

export function yearMinFromY(clientY, el) {
  const rect = el.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
  const ratio = rect.height > 0 ? y / rect.height : 0;
  return snapMin(DAY_START_MIN + ratio * VISIBLE_MINUTES);
}

export function yearHourDragStart(ymd, ev) {
  if (ev.target.closest && (ev.target.closest('[data-hour-log]') || ev.target.closest('[data-task-id]'))) return;
  const el = ev.currentTarget;
  const m = yearMinFromY(ev.clientY, el);
  state.yearHourDrag = { date: ymd, startMin: m, endMin: m + SLOT_MINUTES };
  state.yearSelectedLogId = null;
  ev.preventDefault();
  renderYearHourDraft();
}

export function yearHourDragMove(ymd, ev) {
  if (!state.yearHourDrag || state.yearHourDrag.date !== ymd) return;
  state.yearHourDrag.endMin = yearMinFromY(ev.clientY, ev.currentTarget);
  renderYearHourDraft();
}

export function yearHourDragEnd() {
  if (!state.yearHourDrag) return;
  let a = state.yearHourDrag.startMin;
  let b = state.yearHourDrag.endMin;
  const date = state.yearHourDrag.date;
  state.yearHourDrag = null;
  if (b < a) { const t = a; a = b; b = t; }
  if (b - a < SLOT_MINUTES) b = a + SLOT_MINUTES;
  a = clampVisibleMin(a);
  b = clampVisibleMin(b);
  if (b <= a) b = Math.min(DAY_END_MIN, a + SLOT_MINUTES);
  const log = { id: newHourLogId(), date, startMin: a, endMin: b, label: 'Tracked' };
  upsertYearHourLog(log);
  state.yearSelectedLogId = log.id;
  deps.renderYear();
}

export function renderYearHourDraft() {
  document.querySelectorAll('.year-hour-draft').forEach(el => el.remove());
  if (!state.yearHourDrag) return;
  const col = document.querySelector(`[data-ymd="${ state.yearHourDrag.date }"]`);
  if (!col) return;
  const a = Math.min(state.yearHourDrag.startMin, state.yearHourDrag.endMin);
  const b = Math.max(state.yearHourDrag.startMin, state.yearHourDrag.endMin);
  const div = document.createElement('div');
  div.className = 'year-hour-draft';
  div.style.top = (a / 60) * HOUR_H + 'px';
  div.style.height = (Math.max(SLOT_MINUTES, b - a) / 60) * HOUR_H + 'px';
  col.appendChild(div);
}

export function renderYearHourEdit() {
  const wrap = document.getElementById('year-hour-edit');
  if (!wrap) return;
  const log = state.yearHourLogs.find(l => l.id === state.yearSelectedLogId);
  if (!log || state.yearCalendarView !== 'week') { wrap.style.display = 'none';
    wrap.innerHTML = '';
    return; }
  wrap.style.display = 'flex';
  wrap.innerHTML = `
    <strong>${ esc(log.date) }</strong>
    <span>${ formatClock(log.startMin) }–${ formatClock(log.endMin) } (${ hoursBetween(log.startMin, log.endMin).toFixed(1) }h)</span>
    <input type="text" value="${ esc(log.label || '') }" placeholder="Label"
      onchange="updateYearHourLabel('${ log.id }', this.value)" />
    <button class="btn" onclick="nudgeYearHourEdge('${ log.id }','start',-${ SLOT_MINUTES })">Start −30m</button>
    <button class="btn" onclick="nudgeYearHourEdge('${ log.id }','start',${ SLOT_MINUTES })">Start +30m</button>
    <button class="btn" onclick="nudgeYearHourEdge('${ log.id }','end',-${ SLOT_MINUTES })">End −30m</button>
    <button class="btn" onclick="nudgeYearHourEdge('${ log.id }','end',${ SLOT_MINUTES })">End +30m</button>
    <button class="btn danger-outline" onclick="deleteYearHourLog('${ log.id }')">Delete</button>
  `;
}

export function updateYearHourLabel(id, val) {
  const log = state.yearHourLogs.find(l => l.id === id);
  if (!log) return;
  upsertYearHourLog({ ...log, label: String(val || '').trim() || undefined });
  deps.renderYear();
}

export function nudgeYearHourEdge(id, edge, delta) {
  const log = state.yearHourLogs.find(l => l.id === id);
  if (!log) return;
  let startMin = log.startMin;
  let endMin = log.endMin;
  if (edge === 'start') {
    startMin = clampVisibleMin(startMin + delta);
    if (startMin > endMin - SLOT_MINUTES) startMin = endMin - SLOT_MINUTES;
  } else {
    endMin = clampVisibleMin(endMin + delta);
    if (endMin < startMin + SLOT_MINUTES) endMin = startMin + SLOT_MINUTES;
  }
  upsertYearHourLog({ ...log, startMin, endMin });
  deps.renderYear();
}
