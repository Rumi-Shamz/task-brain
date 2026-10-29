import {
  state, YEAR_DAYS, DEEP_REST_DAYS, seedYearRhythm, normalizeRhythm, normalizeHourLogs,
  rhythmWithHours, paintYear, dateForDay, mondayOfWeek, clampDay, dayIndexToday, formatYmd,
  parseYmd, addDaysLocal, mondayOnOrBefore, defaultWorkSchedule, workWindowFromMonth, seasonSpec,
  workWindowRuleText, statsBuckets, formatHHMM, esc, pad2,
} from './state.js';
import { deps } from './deps.js';
import { cycleDayIndex, mondayOfYmd, blocksOnDate } from './blocks.js';
import { domainStyleVar } from './domains.js';
import { renderYearHourEdit, yearHourDragEnd } from './year-hours.js';
import { renderProtocolEditor, renderYearScheduleControls } from './year-settings.js';
import { renderYearWeek, yearPeriod } from './year-week.js';
import { stepPeriod } from './year-period.js';
import { act } from './actions.js';

export {
  renderYearScheduleControls, resetWorkScheduleDefaults, toggleSeasonMonth, renderProtocolEditor,
  setProtocolCycle, setProtocolVacation, setProtocolDeepRest, removeActivityRule,
} from './year-settings.js';
export {
  upsertYearHourLog, deleteYearHourLog, selectYearHourLog, yearMinFromY, yearHourDragStart, yearHourDragMove,
  yearHourDragEnd, renderYearHourDraft, renderYearHourEdit, updateYearHourLabel, nudgeYearHourEdge,
} from './year-hours.js';
export * from './year-events.js';

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

function snapYearToNow(view) {
  const now = new Date();
  if (view === 'week' || view === 'year') focusYearDate(formatYmd(now));
  if (view === 'month' || view === 'year') {
    state.yearMonthCursor = { year: now.getFullYear(), month: now.getMonth() };
  }
  if (view === 'year') state.yearOverviewYear = now.getFullYear();
}

export function openCurrentMonth() {
  snapYearToNow('month');
  setYearCalendarView('month');
}

export function openCurrentWeek() {
  snapYearToNow('week');
  setYearCalendarView('week');
}

export function setYearMobileDay(offset) {
  state.yearMobileDay = Math.max(0, Number(offset) || 0);
  deps.renderYear();
}

export function openYearMonthView(year, month) {
  state.yearMonthCursor = { year: Number(year), month: Number(month) };
  setYearCalendarView('month');
}

/** Week view focus: any day of the work or rest period on screen. Keeps the Monday for the week number. */
function focusYearDate(ymd) {
  state.yearFocusDate = ymd;
  state.yearFocusMonday = mondayOfYmd(ymd);
}

/** Week view Prev/Next: work → rest → work, two periods a week. */
export function stepYearPeriod(dir) {
  const next = stepPeriod(yearPeriod(), dir, state.yearRhythm && state.yearRhythm.workSchedule);
  focusYearDate(next.start);
  const d = parseYmd(next.start);
  if (d) state.yearMonthCursor = { year: d.getFullYear(), month: d.getMonth() };
  deps.renderYear();
}

export function yearNav(dir) {
  if (state.yearCalendarView === 'week') stepYearPeriod(dir);
  else if (state.yearCalendarView === 'year') {
    const y = state.yearOverviewYear || new Date().getFullYear();
    state.yearOverviewYear = y + dir;
    deps.renderYear();
  } else nudgeYearMonth(dir);
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
  focusYearDate(formatYmd(addDaysLocal(cycleStart, target)));
  state.yearCalendarView = 'week';
  deps.renderYear();
}

export function markYearWeekDate(ymd) {
  focusYearDate(ymd);
  const d = parseYmd(ymd);
  if (d) state.yearMonthCursor = { year: d.getFullYear(), month: d.getMonth() };
  deps.renderYear();
}

/** Clicking a day in Year or Month opens the work or rest period that day belongs to. */
export function selectYearWeekDate(ymd) {
  focusYearDate(ymd);
  const d = parseYmd(ymd);
  if (d) state.yearMonthCursor = { year: d.getFullYear(), month: d.getMonth() };
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
  snapYearToNow(state.yearCalendarView || 'month');
}

window.addEventListener('mouseup', () => {
  if (state.yearHourDrag) yearHourDragEnd();
});

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
      `Work is ${ counts.work } regular work days and ${ counts.sprint } sprint days. Free is ${ counts.free } days off and ${ counts.vacation } vacation days. Reset is ${ counts.fast } fast, ${ counts.restore } restore and ${ counts.deepRest } deep rest days. Protocol days: ${ protocol } (${ pct }% of the year).`;
  }

  const todayIdx = dayIndexToday(state.yearRhythm);
  const callout = document.getElementById('year-this-week');
  if (!callout) { /* skip callout */ }
  else if (todayIdx == null) {
    callout.innerHTML = `<h3>Outside this personal year</h3>
      <p>Your year runs 364 days from ${ esc(state.yearRhythm.yearStartMonday) } and today is past it. Set a new year start Monday to begin the next one.</p>`;
  } else {
    const week = formatRhythmWeek(todayIdx);
    const cell = cells[todayIdx];
    const date = dateForDay(state.yearRhythm.yearStartMonday, todayIdx);
    const workSched = (state.yearRhythm && state.yearRhythm.workSchedule) || defaultWorkSchedule();
    const window = date ? workWindowFromMonth(date.getMonth(), workSched) : 'long';
    const spec = seasonSpec(workSched, window);
    const dateStr = date ? formatYmd(date) : `day ${ todayIdx }`;
    const DETAIL = {
      fast: 'A fast day. It counts as reset.',
      restore: 'A restore day. It counts as reset.',
      sprint: 'A sprint day. It counts as work.',
      deepRest: 'Deep rest: no inputs, no work.',
      vacation: 'A vacation day. It counts as free.',
      conflict: 'Two protocols overlap on this day. Move one of them.',
      work: `A regular work day (${ workWindowRuleText(spec) }).`,
    };
    const detail = DETAIL[cell.kind] || `A day off (${ workWindowRuleText(spec) }).`;
    const n = week.replace(/^W/, '');
    callout.innerHTML = `<h3>Today, ${ esc(dateStr) }${ n === '–' ? '' : `, week ${ esc(n) }` }</h3>
      <p>${ cell.labels.length ? `<strong>${ esc(cell.labels.join(', ')) }.</strong> ` : '' }${ esc(detail) }</p>`;
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
  const focusDates = yearPeriod().dates;
  const weekStart = mondayOfWeek(state.yearWeekMonday);
  const weekEnd = Math.min(YEAR_DAYS - 1, weekStart + 6);
  const weekA = dateForDay(state.yearRhythm.yearStartMonday, weekStart);
  const weekB = dateForDay(state.yearRhythm.yearStartMonday, weekEnd);
  const focusIdx = cycleDayIndex(state.yearRhythm.yearStartMonday, state.yearFocusMonday || formatYmd(new Date()));
  const wNum = focusIdx != null ? rhythmWeekNumber(focusIdx) : rhythmWeekNumber(weekStart);
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
  if (state.yearOverviewYear == null) state.yearOverviewYear = new Date().getFullYear();
  const calYear = state.yearOverviewYear;
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
      const appts = blocksOnDate(ymd, { includeAllDay: true }).filter(b => b.rule === 'event');
      const apptText = appts.map(b => (b.allDay ? '' : formatHHMM(b.startMin) + ' ') + b.name).join(' · ');
      const title = `${ ymd } · ${ (cell.labels || []).join(' · ') || cell.kind }${ apptText ? ' · ' + apptText : '' } · click → its work or rest period`;
      // The 12-month overview dots only what is not a plain weekly habit (monthly, yearly, one-off, every N weeks).
      const dotted = large ? appts : appts.filter(b => b.repeat.freq !== 'weekly' || b.repeat.interval > 1);
      const dots = dotted.length
        ? `<span class="ydots">${ dotted.slice(0, large ? 4 : 3).map(b => `<i style="${ domainStyleVar(b.domain) }"></i>`).join('') }</span>` : '';
      const names = large && appts.length
        ? `<span class="ynames">${ appts.slice(0, 2).map(b => `<span style="${ domainStyleVar(b.domain) }">${ esc(b.name) }</span>`).join('') }</span>` : '';
      const todayY = formatYmd(new Date());
      const hi = ymd === todayY ? 'outline:2px solid var(--txt);' : '';
      const inWeek = focusDates.includes(ymd) ? ' in-week' : '';
      return `<button type="button" class="year-cell yc-${ cell.kind }${ inWeek }" title="${ esc(title) }" style="${ hi }height:${ cellH }px"
        ${act('selectYearWeekDate', ymd)}>${ slotCell.dom }${ dots }${ names }</button>`;
    }).join('');
    const titleClick = large
      ? `${ MONTHS[slot.month] } ${ slot.year }`
      : `<button type="button" class="btn" style="padding:0;border:none;background:none;font:inherit;font-weight:600;cursor:pointer;color:var(--txt)" ${act('openYearMonthView', slot.year,slot.month)}>${ MONTHS[slot.month] } ${ slot.year }</button>`;
    return `<div class="year-month-card${ large ? ' large' : '' }"><h4>${ titleClick }</h4><div class="year-month-hint">${ seasonHint }</div><div class="year-month-grid">${ head }${ body }</div></div>`;
  }

  // Mobile never shows 12-month year overview
  if (state.yearCalendarView === 'year' && isMobileYearLayout()) {
    state.yearCalendarView = 'month';
  }

  if (state.yearCalendarView === 'week') {
    renderYearWeek(cells, sectionLabel);
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

  if (sectionLabel) sectionLabel.textContent = 'Click a month name to open it, or a day to open its work or rest period. Week 1 is the first week after deep rest.';
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

