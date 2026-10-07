/** Year → Week: hourly columns with seasons, protocol shading, recurring series, hour logs and tasks. */
import {
  DAY_END_MIN, DAY_START_MIN, HOUR_H, VIEW_SCROLL_TOP, WEEK_COL_H, WEEK_HOUR_END, WEEK_HOUR_START,
  addDaysLocal, defaultWorkSchedule, esc, formatClock, formatHHMM, formatYmd, hoursBetween, pad2,
  parseYmd, seasonSpec, seasonalWorkShadeRange, state, statsBuckets, workWindowFromMonth,
  workWindowRuleText,
} from './state.js';
import { allDayOnDate, blocksOnDate, cycleDayIndex, mondayOfYmd, weekWorkDates } from './blocks.js';
import { seriesDetails } from './recurring.js';
import { domainStyleVar } from './domains.js';
import { renderYearHourEdit } from './year-hours.js';
import { weekTaskBlocksHTML } from './dashboard.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** cells: paintYear() result; sectionLabel: the view caption element (may be null). */
export function renderYearWeek(cells, sectionLabel) {
  if (sectionLabel) sectionLabel.textContent = '';
  if (!state.yearFocusMonday) state.yearFocusMonday = mondayOfYmd(formatYmd(new Date()));
  const workSched = (state.yearRhythm && state.yearRhythm.workSchedule) || defaultWorkSchedule();
  // Work days, plus any other day of this week with an appointment (e.g. a Saturday class).
  const workDates = weekWorkDates(state.yearFocusMonday);
  const weekDates = Array.from({ length: 7 }, (_, i) => formatYmd(addDaysLocal(parseYmd(state.yearFocusMonday), i)))
    .filter(ymd => workDates.includes(ymd) || blocksOnDate(ymd, { includeAllDay: true }).length);
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
    const taskBlocks = ymd ? weekTaskBlocksHTML(ymd) : '';
    const series = blocksOnDate(ymd).map(b => `<div class="year-week-series ${ b.rule === 'event' ? 'event' : 'open' }"
        style="${ domainStyleVar(b.domain) }top:${ b.startMin / 60 * HOUR_H }px;height:${ Math.max(14, (b.endMin - b.startMin) / 60 * HOUR_H) }px"
        title="${ esc(b.name) } · ${ esc(formatHHMM(b.startMin)) }–${ esc(formatHHMM(b.endMin)) } · ${ esc(seriesDetails(b)) }">
        <span>${ esc(b.name) }</span></div>`).join('');
    const todayMark = ymd === formatYmd(new Date()) ? ' is-today' : '';
    return `<div class="year-week-col${ todayMark }" data-ymd="${ esc(ymd) }"
      onmousedown="yearHourDragStart('${ ymd }', event)"
      onmousemove="yearHourDragMove('${ ymd }', event)"
      style="height:${ WEEK_COL_H }px;min-height:${ WEEK_COL_H }px">${ lines.join('') }${ protocol }${ season }${ series }${ blocks }${ taskBlocks }</div>`;
  }

  const grid = document.getElementById('year-grid');
  if (!grid) return;

  const colCount = Math.max(1, weekDates.length);
  const heads = weekDates.map(ymd => {
    const date = parseYmd(ymd);
    const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
    const cell = idx == null ? { kind: 'free', labels: [] } : cells[idx];
    const wd = date ? (date.getDay() === 0 ? 6 : date.getDay() - 1) : 0;
    const allDay = allDayOnDate(ymd).map(b =>
      `<span class="allday-chip" style="${ domainStyleVar(b.domain) }" title="${ esc(b.name) }">${ esc(b.name) }</span>`).join('');
    return `<button type="button" class="year-week-head yc-${ cell.kind }" onclick="markYearWeekDate('${ ymd }')">
      <span class="wd">${ WEEKDAYS[wd] }</span>
      <span class="dd">${ date ? date.getDate() : '' }</span>
      ${ allDay ? `<span class="allday-row">${ allDay }</span>` : '' }
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
}
