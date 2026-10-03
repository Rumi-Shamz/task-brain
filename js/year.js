import {
  state, YEAR_DAYS, FAST_DAYS, RESTORE_DAYS, SPRINT_DAYS, CYCLE_DAYS, DEEP_REST_DAYS, VACATION_DAYS,
  HOUR_H, WEEK_COL_H, WEEK_HOUR_START, WEEK_HOUR_END, VIEW_SCROLL_TOP, VIEW_HOUR_START, VIEW_HOUR_END,
  DAY_START_MIN, DAY_END_MIN, VISIBLE_MINUTES, SLOT_MINUTES, WEEKDAY_SHORT, MONTH_SHORT_WS, DEFAULT_DURATION,
  seedYearRhythm, normalizeRhythm, normalizeHourLogs, rhythmWithHours, paintYear, dateForDay,
  mondayOfWeek, clampDay, weekdayOfDay, dayIndexToday, formatYmd, parseYmd, addDaysLocal,
  mondayOnOrBefore, formatClock, hoursBetween, snapMin, clampVisibleMin, defaultWorkSchedule,
  normalizeWorkSchedule, workWindowFromMonth, seasonSpec, hourLabel, monthsLabel, workWindowLabel,
  workWindowRuleText, seasonalWorkShadeRange, statsBuckets, newHourLogId, formatHHMM, parseHHMM,
  snapCalMins, clampCalStart, clampHour, clampWeekdayIdx, CAL_DAY_START, CAL_DAY_END, CAL_MIN_DURATION,
  projectClass, projectColStyleAttr, chipControlsHTML, esc, pad2, allProjects, LANES, uid
} from './state.js';
import { deps } from './deps.js';
import {
  cycleDayIndex, weekWorkDates, mondayOfYmd, dayBlocks, activityRules, isTaskDay,
} from './blocks.js';

export function setYearAnchor(value) {
  const parsed = parseYmd(value);
  if (!parsed) return;
  state.yearRhythm = { ...state.yearRhythm, yearStartMonday: formatYmd(mondayOnOrBefore(parsed)) };
  deps.save();
  deps.renderYear();
}

export function resetYearSeed() { state.yearRhythm = seedYearRhythm(state.yearRhythm.yearStartMonday);
  state.yearHourLogs = [];
  deps.save();
  deps.renderYear(); }

export function importYearJson() {
  const msg = document.getElementById('year-import-msg');
  try {
    const raw = JSON.parse(document.getElementById('year-json-input').value);
    state.yearRhythm = normalizeRhythm(raw);
    if (!Array.isArray(raw.cycles) || raw.cycles.length !== 4) throw new Error('Need 4 cycles');
    if (!Array.isArray(raw.vacations) || raw.vacations.length !== 4) throw new Error('Need 4 vacations');
    state.yearHourLogs = normalizeHourLogs(raw.hourLogs);
    deps.save();
    deps.renderYear();
    msg.className = 'year-import-msg';
    msg.textContent = 'Imported.';
  } catch (e) { msg.className = 'year-import-msg err';
    msg.textContent = e.message || 'Invalid JSON'; }
}

export async function exportYearJson() {
  const msg = document.getElementById('year-import-msg');
  const text = JSON.stringify(rhythmWithHours(), null, 2);
  try { await navigator.clipboard.writeText(text);
    msg.className = 'year-import-msg';
    msg.textContent = 'JSON copied (includes hourLogs).'; } catch { document.getElementById('year-json-input').value = text;
    msg.className = 'year-import-msg';
    msg.textContent = 'Could not copy — JSON placed in the textarea.'; }
}

export function isMobileYearLayout() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
}

export function setYearCalendarView(view) {
  let v = view === 'week' ? 'week' : view === 'month' ? 'month' : 'year';
  // Year overview is desktop-only — on phones default to Month (Google Calendar style)
  if (v === 'year' && isMobileYearLayout()) v = 'month';
  state.yearCalendarView = v;
  deps.renderYear();
}

export function setYearMobileDay(offset) {
  state.yearMobileDay = Math.max(0, Number(offset) || 0);
  deps.renderYear();
}

export function openYearMonthView(year, month) {
  state.yearMonthCursor = { year: Number(year), month: Number(month) };
  setYearCalendarView('month');
}

export function nudgeYearWeek(delta) {
  const base = state.yearFocusMonday || formatYmd(new Date());
  const mon = parseYmd(mondayOfYmd(base)) || new Date();
  state.yearFocusMonday = formatYmd(addDaysLocal(mon, delta));
  deps.renderYear();
}

export function yearNav(dir) {
  if (state.yearCalendarView === 'week') nudgeYearWeek(dir * 7);
  else nudgeYearMonth(dir);
}

export function nudgeYearMonth(delta) {
  const d = new Date(state.yearMonthCursor.year, state.yearMonthCursor.month + delta, 1);
  state.yearMonthCursor = { year: d.getFullYear(), month: d.getMonth() };
  deps.renderYear();
}

/** First Monday after the 28-day deep rest = rhythm W1. */
export function firstWorkWeekMonday(rhythm) {
  const r = rhythm || state.yearRhythm;
  if (!r || !r.deepRest) return 0;
  const after = clampDay((r.deepRest.startDay || 0) + DEEP_REST_DAYS);
  return mondayOfWeek(after);
}

/** 1-based week number after deep rest; null if before W1. */
export function rhythmWeekNumber(dayIndex, rhythm) {
  const start = firstWorkWeekMonday(rhythm);
  const di = mondayOfWeek(clampDay(dayIndex));
  if (di < start) return null;
  return Math.floor((di - start) / 7) + 1;
}

export function formatRhythmWeek(dayIndex, rhythm) {
  const n = rhythmWeekNumber(dayIndex, rhythm);
  return n == null ? 'W–' : `W${n}`;
}

export function pickYearWeek(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || !state.yearRhythm) return;
  const focus = state.yearFocusMonday || formatYmd(new Date());
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, focus);
  const focusDate = parseYmd(focus);
  if (idx == null || !focusDate) return;
  const cycleStart = addDaysLocal(focusDate, -idx);
  const origin = firstWorkWeekMonday();
  const target = origin + (Math.max(1, n) - 1) * 7;
  state.yearFocusMonday = formatYmd(addDaysLocal(cycleStart, target));
  state.yearCalendarView = 'week';
  deps.renderYear();
}

export function markYearWeekDate(ymd) {
  state.yearFocusMonday = mondayOfYmd(ymd);
  const d = parseYmd(ymd);
  if (d) state.yearMonthCursor = { year: d.getFullYear(), month: d.getMonth() };
  deps.renderYear();
}

export function selectYearWeekDate(ymd) {
  state.yearFocusMonday = mondayOfYmd(ymd);
  state.yearCalendarView = 'week';
  deps.renderYear();
}

export function selectYearWeek(day) { state.yearWeekMonday = mondayOfWeek(day);
  state.yearCalendarView = 'week';
  deps.renderYear(); }

export function selectYearMonth(day) {
  const date = dateForDay(state.yearRhythm.yearStartMonday, day);
  if (date) state.yearMonthCursor = { year: date.getFullYear(), month: date.getMonth() };
  state.yearCalendarView = 'month';
  deps.renderYear();
}

export function markYearWeek(day) {
  state.yearWeekMonday = mondayOfWeek(day);
  const date = dateForDay(state.yearRhythm.yearStartMonday, day);
  if (date) state.yearMonthCursor = { year: date.getFullYear(), month: date.getMonth() };
  deps.renderYear();
}

export function ensureYearWeekMonday() {
  if (!state.yearRhythm) return;
  if (!state.yearFocusMonday) state.yearFocusMonday = mondayOfYmd(formatYmd(new Date()));
  const d = parseYmd(state.yearFocusMonday);
  if (d && state.yearCalendarView !== 'month') {
    state.yearMonthCursor = { year: d.getFullYear(), month: d.getMonth() };
  }
}

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

window.addEventListener('mouseup', () => {
  if (state.yearHourDrag) yearHourDragEnd();
});

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


export function renderYearScheduleControls() {
  const el = document.getElementById('year-schedule-controls');
  const rule = document.getElementById('year-schedule-rule');
  if (!state.yearRhythm) return;
  state.yearRhythm.workSchedule = normalizeWorkSchedule(state.yearRhythm.workSchedule);
  const s = state.yearRhythm.workSchedule;
  if (rule) { rule.textContent = 'Long: ' + workWindowRuleText(s.long) + ' · Short: ' + workWindowRuleText(s.short); }
  if (!el) return;
  const wdOpts = WEEKDAY_SHORT.map((label, i) => `<option value="${ i }">${ label }</option>`).join('');
  const seasonRow = (key, label) => {
    const spec = s[key];
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
      <strong style="min-width:90px;font-size:12px;">${ label }</strong>
      <label style="font-size:11px;color:var(--txt3);">Months
        <input data-ws="${ key }" data-field="months" value="${ spec.months.join(',') }" style="width:120px;margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);" />
      </label>
      <label style="font-size:11px;color:var(--txt3);">Start
        <select data-ws="${ key }" data-field="startWeekday" style="margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);">${ wdOpts }</select>
        <input type="number" min="0" max="23" data-ws="${ key }" data-field="startHour" value="${ spec.startHour }" style="width:52px;margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);" />
      </label>
      <label style="font-size:11px;color:var(--txt3);">End
        <select data-ws="${ key }" data-field="endWeekday" style="margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);">${ wdOpts }</select>
        <input type="number" min="0" max="23" data-ws="${ key }" data-field="endHour" value="${ spec.endHour }" style="width:52px;margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);" />
      </label>
    </div>`;
  };
  el.innerHTML = seasonRow('long','Long season') + seasonRow('short','Short season')
    + `<button class="btn" type="button" onclick="resetWorkScheduleDefaults()">Reset schedule defaults</button>`;
  el.querySelectorAll('[data-ws]').forEach(inp => {
    const key = inp.getAttribute('data-ws');
    const field = inp.getAttribute('data-field');
    if (field === 'startWeekday' || field === 'endWeekday') inp.value = String(s[key][field]);
    const apply = () => {
      const spec = { ...state.yearRhythm.workSchedule[key] };
      if (field === 'months') {
        const months = String(inp.value).split(/[,\s]+/).map(x => parseInt(x,10)).filter(n => Number.isFinite(n) && n>=0 && n<=11);
        if (!months.length) return;
        spec.months = [...new Set(months)].sort((a,b)=>a-b);
      } else if (field === 'startHour' || field === 'endHour') { spec[field] = clampHour(inp.value); } else { spec[field] = clampWeekdayIdx(inp.value); }
      state.yearRhythm.workSchedule = normalizeWorkSchedule({ ...state.yearRhythm.workSchedule, [key]: spec });
      deps.save();
      deps.renderYear();
    };
    inp.onchange = apply;
    if (inp.tagName === 'INPUT' && inp.type !== 'number') inp.onblur = apply;
  });
}
export function resetWorkScheduleDefaults() { state.yearRhythm.workSchedule = defaultWorkSchedule();
  deps.save();
  deps.renderYear(); }

export function renderYear() {
  if (!state.yearRhythm) state.yearRhythm = seedYearRhythm();
  state.yearWeekMonday = mondayOfWeek(state.yearWeekMonday || 0);
  if (!state.yearFocusMonday) state.yearFocusMonday = mondayOfYmd(formatYmd(new Date()));
  renderYearScheduleControls();
  renderProtocolEditor();
  const cells = paintYear(state.yearRhythm);
  const anchorEl = document.getElementById('year-anchor');
  if (anchorEl) anchorEl.value = state.yearRhythm.yearStartMonday;

  const counts = { fast:0, restore:0, sprint:0, deepRest:0, vacation:0, work:0, free:0, conflict:0 };
  cells.forEach(c => { counts[c.kind] = (counts[c.kind] || 0) + 1; });
  const buckets = statsBuckets(counts);
  const protocol = counts.fast + counts.restore + counts.sprint + counts.deepRest + counts.vacation;
  const pct = Math.round((protocol / YEAR_DAYS) * 100);
  const statsEl = document.getElementById('year-stats');
  if (statsEl) {
    statsEl.innerHTML = `
    <div><div class="year-stat">${ buckets.work }</div><div class="year-stat-label">Work</div></div>
    <div><div class="year-stat">${ buckets.free }</div><div class="year-stat-label">Free</div></div>
    <div><div class="year-stat">${ buckets.reset }</div><div class="year-stat-label">Reset</div></div>
    <div><div class="year-stat">${ buckets.conflict }</div><div class="year-stat-label">Conflicts</div></div>
  `;
  }
  const substatsEl = document.getElementById('year-substats');
  if (substatsEl) {
    substatsEl.textContent =
      `Sub: seasonal work ${ counts.work } · sprint ${ counts.sprint } · seasonal off ${ counts.free } · vacation ${ counts.vacation } · fast ${ counts.fast } · restore ${ counts.restore } · deep rest ${ counts.deepRest } · protocol ${ protocol } (${ pct }%)`;
  }

  const todayIdx = dayIndexToday(state.yearRhythm);
  const callout = document.getElementById('year-this-week');
  if (!callout) { /* skip callout */ }
  else if (todayIdx == null) {
    callout.innerHTML = `<h3>Outside this personal year</h3>
      <p>Today is outside the 364-day window starting ${ esc(state.yearRhythm.yearStartMonday) }. Adjust the year start Monday, or roll into the next revolving year.</p>`;
  } else {
    const week = formatRhythmWeek(todayIdx);
    const cell = cells[todayIdx];
    const date = dateForDay(state.yearRhythm.yearStartMonday, todayIdx);
    const workSched = (state.yearRhythm && state.yearRhythm.workSchedule) || defaultWorkSchedule();
    const window = date ? workWindowFromMonth(date.getMonth(), workSched) : 'long';
    const spec = seasonSpec(workSched, window);
    const dateStr = date ? formatYmd(date) : `day ${ todayIdx }`;
    let detail = '';
    if (cell.kind === 'fast') detail = 'Fast day (Reset).';
    else if (cell.kind === 'restore') detail = 'Restoration day (Reset).';
    else if (cell.kind === 'sprint') detail = 'Sprint protocol day — counts as Work (≠ seasonal overlay).';
    else if (cell.kind === 'deepRest') detail = 'Deep rest (Reset) — no inputs, no work.';
    else if (cell.kind === 'vacation') detail = 'Vacation protocol — counts as Free (≠ seasonal off).';
    else if (cell.kind === 'conflict') detail = 'Conflict — overlapping protocols on this day.';
    else if (cell.kind === 'work') detail = `Seasonal work overlay · ${ workWindowRuleText(spec) }.`;
    else detail = `Seasonal off · ${ workWindowRuleText(spec) }.`;
    callout.innerHTML = `<h3>Today · ${ esc(dateStr) } · ${ week }</h3>
      <p><strong>${ esc(cell.labels.join(' · ') || cell.kind) }</strong> — ${ esc(detail) }</p>`;
  }

  const yearBtn = document.getElementById('year-view-year');
  const monthBtn = document.getElementById('year-view-month');
  const weekBtn = document.getElementById('year-view-week');
  const weekNav = document.getElementById('year-week-nav');
  const monthNav = document.getElementById('year-month-nav');
  const weekLabel = document.getElementById('year-week-label');
  const monthLabel = document.getElementById('year-month-label');
  const sectionLabel = document.getElementById('year-section-label');
  if (yearBtn) yearBtn.classList.toggle('active', state.yearCalendarView === 'year');
  if (monthBtn) monthBtn.classList.toggle('active', state.yearCalendarView === 'month');
  if (weekBtn) weekBtn.classList.toggle('active', state.yearCalendarView === 'week');
  if (weekNav) weekNav.style.display = state.yearCalendarView === 'week' ? 'inline-flex' : 'none';
  if (monthNav) monthNav.style.display = 'none';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const weekStart = mondayOfWeek(state.yearWeekMonday);
  const weekEnd = Math.min(YEAR_DAYS - 1, weekStart + 6);
  const weekA = dateForDay(state.yearRhythm.yearStartMonday, weekStart);
  const weekB = dateForDay(state.yearRhythm.yearStartMonday, weekEnd);
  const wNum = rhythmWeekNumber(weekStart);
  if (weekLabel) {
    const a = weekA ? `${ MONTHS[weekA.getMonth()] } ${ weekA.getDate() }` : `D${ weekStart }`;
    const b = weekB ? `${ MONTHS[weekB.getMonth()] } ${ weekB.getDate() }` : `D${ weekEnd }`;
    weekLabel.textContent = `${ formatRhythmWeek(weekStart) } · ${ a } – ${ b }`;
  }
  if (monthLabel) {
    monthLabel.textContent = `${ MONTHS[state.yearMonthCursor.month] } ${ state.yearMonthCursor.year }`;
  }
  const weekPicker = document.getElementById('year-week-picker');
  if (weekPicker) {
    const origin = firstWorkWeekMonday();
    const maxW = Math.max(1, Math.floor((YEAR_DAYS - 1 - origin) / 7) + 1);
    weekPicker.min = '1';
    weekPicker.max = String(maxW);
    weekPicker.value = wNum != null ? String(wNum) : '1';
  }

  const start = parseYmd(state.yearRhythm.yearStartMonday);
  const mid = start ? addDaysLocal(start, Math.floor(YEAR_DAYS / 2)) : null;
  const calYear = mid ? mid.getFullYear() : (start ? start.getFullYear() : new Date().getFullYear());
  const indexByYmd = new Map();
  if (start) {
    for (let d = 0; d < YEAR_DAYS; d++) { indexByYmd.set(formatYmd(addDaysLocal(start, d)), d); }
  }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function weekdayMon0(y, m, dom) {
    const wd = new Date(y, m, dom).getDay();
    return wd === 0 ? 6 : wd - 1;
  }
  function dayIndexesForMonth(y, month) {
    const days = [];
    const dim = daysInMonth(y, month);
    for (let dom = 1; dom <= dim; dom++) {
      const ymd = `${ y }-${ pad2(month + 1) }-${ pad2(dom) }`;
      let idx = indexByYmd.has(ymd) ? indexByYmd.get(ymd) : undefined;
      if (idx === undefined && month === 0) {
        const wrapYmd = `${ y + 1 }-01-${ pad2(dom) }`;
        if (indexByYmd.has(wrapYmd)) idx = indexByYmd.get(wrapYmd);
      }
      if (idx === undefined && month === 11) {
        const prevYmd = `${ y - 1 }-12-${ pad2(dom) }`;
        if (indexByYmd.has(prevYmd)) idx = indexByYmd.get(prevYmd);
      }
      if (idx !== undefined) days.push(idx);
    }
    return days;
  }

  function monthCardHtml(slot, large) {
    const dim = daysInMonth(slot.year, slot.month);
    const lead = weekdayMon0(slot.year, slot.month, 1);
    const byDom = new Map();
    slot.days.forEach(di => {
      const date = dateForDay(state.yearRhythm.yearStartMonday, di);
      if (date) byDom.set(date.getDate(), di);
    });
    const cellsOut = [];
    for (let i = 0; i < lead; i++) cellsOut.push({ dom: 0, di: null });
    for (let dom = 1; dom <= dim; dom++) {
      cellsOut.push({ dom, di: byDom.has(dom) ? byDom.get(dom) : null });
    }
    while (cellsOut.length % 7 !== 0) cellsOut.push({ dom: 0, di: null });
    const _sched = state.yearRhythm.workSchedule || defaultWorkSchedule();
    const seasonHint = workWindowRuleText(seasonSpec(_sched, workWindowFromMonth(slot.month, _sched)));
    const head = ['M','T','W','T','F','S','S'].map(h => `<div class="yh">${ h }</div>`).join('');
    const body = cellsOut.map((slotCell) => {
      const cellH = large ? 54 : 22;
      if (slotCell.dom === 0) return `<div style="height:${ cellH }px"></div>`;
      const ymd = `${ slot.year }-${ pad2(slot.month + 1) }-${ pad2(slotCell.dom) }`;
      const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
      const cell = idx == null ? { kind: 'free', labels: [] } : cells[idx];
      const title = `${ ymd } · ${ (cell.labels || []).join(' · ') || cell.kind } · double-click → week`;
      const todayY = formatYmd(new Date());
      const hi = ymd === todayY ? 'outline:2px solid var(--txt);' : '';
      const focusMon = state.yearFocusMonday || '';
      const inWeek = focusMon && ymd >= focusMon && ymd <= formatYmd(addDaysLocal(parseYmd(focusMon), 6)) ? ' in-week' : '';
      return `<button type="button" class="year-cell yc-${ cell.kind }${ inWeek }" title="${ esc(title) }" style="${ hi }height:${ cellH }px"
        onclick="markYearWeekDate('${ ymd }')" ondblclick="selectYearWeekDate('${ ymd }')">${ slotCell.dom }</button>`;
    }).join('');
    const titleClick = large
      ? `${ MONTHS[slot.month] } ${ slot.year }`
      : `<button type="button" class="btn" style="padding:0;border:none;background:none;font:inherit;font-weight:600;cursor:pointer;color:var(--txt)" onclick="openYearMonthView(${ slot.year },${ slot.month })">${ MONTHS[slot.month] } ${ slot.year }</button>`;
    return `<div class="year-month-card${ large ? ' large' : '' }"><h4>${ titleClick }</h4><div class="year-month-hint">${ seasonHint }</div><div class="year-month-grid">${ head }${ body }</div></div>`;
  }

  // Mobile never shows 12-month year overview
  if (state.yearCalendarView === 'year' && isMobileYearLayout()) {
    state.yearCalendarView = 'month';
  }

  if (state.yearCalendarView === 'week') {
    if (sectionLabel) sectionLabel.textContent = '';
    if (!state.yearFocusMonday) state.yearFocusMonday = mondayOfYmd(formatYmd(new Date()));
    const workSched = (state.yearRhythm && state.yearRhythm.workSchedule) || defaultWorkSchedule();
    const weekDates = weekWorkDates(state.yearFocusMonday);
    const midDate = parseYmd(weekDates[0] || state.yearFocusMonday);
    const seasonWin = midDate ? workWindowFromMonth(midDate.getMonth(), workSched) : 'long';
    const weekSpec = seasonSpec(workSched, seasonWin);
    const weekLogs = state.yearHourLogs.filter(l => weekDates.includes(l.date));
    const weekTotal = weekLogs.reduce((s, l) => s + hoursBetween(l.startMin, l.endMin), 0);
    const weekKinds = weekDates.map(ymd => {
      const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
      return idx == null ? 'free' : cells[idx].kind;
    });
    const wb = statsBuckets({ work: weekKinds.filter(k => k === 'work').length, sprint: weekKinds.filter(k => k === 'sprint').length, free: weekKinds.filter(k => k === 'free').length, vacation: weekKinds.filter(k => k === 'vacation').length, fast: weekKinds.filter(k => k === 'fast').length, restore: weekKinds.filter(k => k === 'restore').length, deepRest: weekKinds.filter(k => k === 'deepRest').length, conflict: weekKinds.filter(k => k === 'conflict').length });

    const gutterMarks = [];
    for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
      gutterMarks.push(`<span style="top:${ h * HOUR_H }px">${ pad2(h) }:00</span>`);
    }

    function weekColHtml(ymd) {
      const date = parseYmd(ymd);
      const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
      const cell = idx == null ? { kind: 'free', labels: [] } : cells[idx];
      const wd = date ? (date.getDay() === 0 ? 6 : date.getDay() - 1) : 0;
      const window = date ? workWindowFromMonth(date.getMonth(), workSched) : seasonWin;
      const spec = seasonSpec(workSched, window);
      const shade = seasonalWorkShadeRange(cell.kind, wd, spec);
      const lines = [];
      for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
        lines.push(`<div class="year-week-hline" style="top:${ h * HOUR_H }px"></div>`);
      }
      const protocol = (cell.kind !== 'work' && cell.kind !== 'free')
        ? `<div class="year-week-protocol yc-${ cell.kind }"></div>` : '';
      const season = shade
        ? `<div class="year-week-season" title="Seasonal work · ${ esc(workWindowRuleText(spec)) }" style="top:${ Math.max(shade.startMin, DAY_START_MIN) / 60 * HOUR_H }px;height:${ Math.max(0, (Math.min(shade.endMin, DAY_END_MIN) - Math.max(shade.startMin, DAY_START_MIN)) / 60 * HOUR_H) }px"></div>`
        : '';
      const dayLogs = ymd ? weekLogs.filter(l => l.date === ymd) : [];
      const blocks = dayLogs.map(log => {
        const top = Math.max(log.startMin, DAY_START_MIN) / 60 * HOUR_H;
        const height = Math.max(0, (Math.min(log.endMin, DAY_END_MIN) - Math.max(log.startMin, DAY_START_MIN)) / 60 * HOUR_H);
        const active = log.id === state.yearSelectedLogId ? ' active' : '';
        return `<button type="button" class="year-hour-block${ active }" data-hour-log="1"
          style="top:${ top }px;height:${ Math.max(height, 18) }px"
          onclick="event.stopPropagation();selectYearHourLog('${ log.id }')"
          ondblclick="event.stopPropagation();deleteYearHourLog('${ log.id }')"
          title="${ esc(formatClock(log.startMin) + '–' + formatClock(log.endMin) + (log.label ? ' · ' + log.label : '')) }">${ esc(formatClock(log.startMin)) } ${ esc(log.label || '') }</button>`;
      }).join('');
      return `<div class="year-week-col" data-ymd="${ esc(ymd) }"
        onmousedown="yearHourDragStart('${ ymd }', event)"
        onmousemove="yearHourDragMove('${ ymd }', event)"
        style="height:${ WEEK_COL_H }px;min-height:${ WEEK_COL_H }px">${ lines.join('') }${ protocol }${ season }${ blocks }</div>`;
    }

    const grid = document.getElementById('year-grid');
    if (!grid) return;

    const colCount = Math.max(1, weekDates.length);
    const heads = weekDates.map(ymd => {
      const date = parseYmd(ymd);
      const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
      const cell = idx == null ? { kind: 'free', labels: [] } : cells[idx];
      const wd = date ? (date.getDay() === 0 ? 6 : date.getDay() - 1) : 0;
      return `<button type="button" class="year-week-head yc-${ cell.kind }" onclick="markYearWeekDate('${ ymd }')">
        <span class="wd">${ WEEKDAYS[wd] }</span>
        <span class="dd">${ date ? date.getDate() : '' }</span>
      </button>`;
    }).join('');
    const cols = weekDates.map(ymd => weekColHtml(ymd)).join('');

    const prevScroll = document.getElementById('year-week-scroll')?.scrollTop;
    const prevScrollX = document.getElementById('year-week-scroll')?.scrollLeft;
    grid.innerHTML = `
      <div class="year-week-frame">
        <div class="year-week-scroll" id="year-week-scroll">
          <div class="year-week-hourly year-week-heads" style="grid-template-columns: 48px repeat(${ colCount }, minmax(0, 1fr));">
            <div class="year-week-gutter-spacer"></div>${ heads }
          </div>
          <div class="year-week-hourly year-week-body" style="grid-template-columns: 48px repeat(${ colCount }, minmax(0, 1fr));">
            <div class="year-week-gutter" style="height:${ WEEK_COL_H }px;min-height:${ WEEK_COL_H }px">${ gutterMarks.join('') }</div>
            ${ cols }
          </div>
        </div>
      </div>`;
    const weekScroll = document.getElementById('year-week-scroll');
    if (weekScroll) {
      if (typeof prevScroll === 'number' && state.yearWeekScrolledOnce) {
        weekScroll.scrollTop = prevScroll;
        if (typeof prevScrollX === 'number') weekScroll.scrollLeft = prevScrollX;
      } else {
        weekScroll.scrollTop = VIEW_SCROLL_TOP;
        state.yearWeekScrolledOnce = true;
      }
    }
    renderYearHourEdit();
    return;
  }

  if (state.yearCalendarView === 'month') {
    const monthDays = dayIndexesForMonth(state.yearMonthCursor.year, state.yearMonthCursor.month);
    const midDay = monthDays.length ? monthDays[Math.floor(monthDays.length / 2)] : weekStart;
    if (sectionLabel) sectionLabel.textContent = '';
    const days = dayIndexesForMonth(state.yearMonthCursor.year, state.yearMonthCursor.month);
    const monthCounts = { fast:0, restore:0, sprint:0, deepRest:0, vacation:0, work:0, free:0, conflict:0 };
    days.forEach(di => { monthCounts[cells[di].kind] = (monthCounts[cells[di].kind] || 0) + 1; });
    const mb = statsBuckets(monthCounts);
    const monthGrid = document.getElementById('year-grid');
    if (!monthGrid) return;
    monthGrid.innerHTML = `
      <div class="year-month-mobile-wrap">
        <div class="year-mobile-stats year-mobile-stats-compact">
          <span>${ mb.work } work</span>
          <span>${ mb.free } free</span>
          <span>${ mb.reset } reset</span>
        </div>
        ${monthCardHtml({ year: state.yearMonthCursor.year, month: state.yearMonthCursor.month, days }, true)}
      </div>
    `;
    renderYearHourEdit();
    return;
  }

  if (sectionLabel) sectionLabel.textContent = 'Year · W1 after deep rest · click month title → month · double-click day → week';
  const yearGrid = document.getElementById('year-grid');
  if (!yearGrid) return;
  const slots = [];
  for (let month = 0; month < 12; month++) {
    slots.push({ year: calYear, month, days: dayIndexesForMonth(calYear, month) });
  }

  const restEnd = state.yearRhythm.deepRest.startDay + DEEP_REST_DAYS - 1;
  const restA = dateForDay(state.yearRhythm.yearStartMonday, state.yearRhythm.deepRest.startDay);
  const restB = dateForDay(state.yearRhythm.yearStartMonday, restEnd);
  const restLabel = restA && restB
    ? `${ MONTHS[restA.getMonth()] } ${ restA.getDate() } – ${ MONTHS[restB.getMonth()] } ${ restB.getDate() }, ${ restA.getFullYear() }`
    : '28 days';

  const top = slots.slice(0, 6).map(s => monthCardHtml(s, false)).join('');
  const bottom = slots.slice(6, 12).map(s => monthCardHtml(s, false)).join('');
  yearGrid.innerHTML = `
    <div class="year-month-row">${ top }</div>
    <div class="year-rest-band"><strong>Deep rest buffer · 28 days</strong><span>${ esc(restLabel) } · ${ calYear } Jan–Dec (wraps into Jan ${ calYear + 1 })</span></div>
    <div class="year-month-row">${ bottom }</div>
  `;
  renderYearHourEdit();
}

function protocolDate(day) {
  const d = dateForDay(state.yearRhythm.yearStartMonday, day);
  return d ? formatYmd(d) : '';
}

export function renderProtocolEditor() {
  const el = document.getElementById('year-protocol-editor');
  if (!el || !state.yearRhythm) return;
  const r = state.yearRhythm;
  const cycles = (r.cycles || []).map((c, i) =>
    `<label>Cycle ${i + 1}<input type="date" value="${protocolDate(c.startDay)}" onchange="setProtocolCycle(${i}, this.value)" /></label>`
  ).join('');
  const vacs = (r.vacations || []).map((v, i) =>
    `<label>Vacation ${i + 1}<input type="date" value="${protocolDate(v.startDay)}" onchange="setProtocolVacation(${i}, this.value)" /></label>`
  ).join('');
  const blocks = dayBlocks().map(b => `<div class="proto-block">
    <input type="text" value="${esc(b.name)}" onchange="patchDayBlock('${b.id}','name',this.value)" />
    <input type="time" value="${formatHHMM(b.startMin)}" onchange="patchDayBlock('${b.id}','start',this.value)" />
    <input type="time" value="${formatHHMM(b.endMin)}" onchange="patchDayBlock('${b.id}','end',this.value)" />
    <select onchange="patchDayBlock('${b.id}','rule',this.value)">
      <option value="leverage" ${b.rule === 'leverage' ? 'selected' : ''}>Leverage only</option>
      <option value="any" ${b.rule === 'any' ? 'selected' : ''}>Any task</option>
      <option value="event" ${b.rule === 'event' ? 'selected' : ''}>Event</option>
    </select>
    <select onchange="patchDayBlock('${b.id}','activity',this.value)" ${b.rule === 'event' ? 'disabled' : ''}>
      <option value="">No activity stamp</option>
      ${['research','communicate','act','learn'].map(a => `<option value="${a}" ${b.activity === a ? 'selected' : ''}>${a}</option>`).join('')}
    </select>
    <button type="button" class="btn" onclick="removeDayBlock('${b.id}')">Remove</button>
  </div>`).join('');
  const rules = activityRules().map(rule => `<li>${esc(rule.kind)} “${esc(rule.value)}” → ${esc(rule.activity)}
    <button type="button" class="btn" onclick="removeActivityRule('${rule.id}')">Remove</button></li>`).join('');
  el.innerHTML = `<div class="section-label">Protocol · repeats every 364 days</div>
    <div class="proto-grid">${cycles}
      <label>Deep rest<input type="date" value="${protocolDate(r.deepRest.startDay)}" onchange="setProtocolDeepRest(this.value)" /></label>
      ${vacs}
    </div>
    <div class="section-label">Recurring day blocks</div>
    ${blocks}
    <button type="button" class="btn" onclick="addDayBlock()">Add block</button>
    <div class="section-label">Activity rules</div>
    <ul class="plan-batch-list">${rules || '<li>No rules yet. Correct an activity on Plan to save one.</li>'}</ul>`;
}

export function setProtocolCycle(i, ymd) {
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null || !state.yearRhythm.cycles[i]) return;
  state.yearRhythm.cycles[i].startDay = idx;
  deps.save();
  deps.renderYear();
}

export function setProtocolVacation(i, ymd) {
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null || !state.yearRhythm.vacations[i]) return;
  state.yearRhythm.vacations[i].startDay = idx;
  deps.save();
  deps.renderYear();
}

export function setProtocolDeepRest(ymd) {
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null) return;
  state.yearRhythm.deepRest.startDay = idx;
  deps.save();
  deps.renderYear();
}

export function patchDayBlock(id, field, value) {
  const b = dayBlocks().find(x => x.id === id);
  if (!b) return;
  if (field === 'name') b.name = String(value || 'Block').slice(0, 40);
  else if (field === 'start') {
    const mins = parseHHMM(value);
    if (mins != null) b.startMin = mins;
  } else if (field === 'end') {
    const mins = parseHHMM(value);
    if (mins != null) b.endMin = mins;
  } else if (field === 'rule') {
    b.rule = value === 'leverage' || value === 'event' || value === 'any' ? value : 'any';
    if (b.rule === 'event') b.activity = null;
  } else if (field === 'activity') {
    b.activity = ['research', 'communicate', 'act', 'learn'].includes(value) ? value : null;
  }
  deps.save();
  deps.renderYear();
}

export function addDayBlock() {
  dayBlocks().push({
    id: uid(), name: 'Block', weekdays: [0, 1, 2, 3, 4],
    startMin: 15 * 60, endMin: 16 * 60, rule: 'any', activity: null,
  });
  deps.save();
  deps.renderYear();
}

export function removeDayBlock(id) {
  state.yearRhythm.dayBlocks = dayBlocks().filter(b => b.id !== id);
  deps.save();
  deps.renderYear();
}

export function removeActivityRule(id) {
  state.activityRules = activityRules().filter(r => r.id !== id);
  deps.save();
  deps.renderYear();
}


