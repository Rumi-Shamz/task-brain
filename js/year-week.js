/**
 * Plan → Week: one work or rest period (js/year-period.js) as hourly columns with seasons, protocol
 * shading, recurring series, hour logs and tasks. Boundary days dim the hours of the other period and
 * leave out what is scheduled there, so work stays in the work view.
 */
import {
  DAY_END_MIN, DAY_START_MIN, DEFAULT_DURATION, HOUR_H, VIEW_SCROLL_TOP, WEEK_COL_H, WEEK_HOUR_END, WEEK_HOUR_START,
  defaultWorkSchedule, esc, formatClock, formatHHMM, formatYmd, hoursBetween, pad2, parseHHMM,
  parseYmd, seasonalWorkShadeRange, state, statsBuckets, workWindowRuleText,
} from './state.js';
import { allDayOnDate, blocksOnDate, cycleDayIndex, mondayOfYmd } from './blocks.js';
import { inPeriod, periodForDate, periodHours } from './year-period.js';
import { seriesDetails } from './recurring.js';
import { domainStyleVar } from './domains.js';
import { renderYearHourEdit } from './year-hours.js';
import { weekTaskBlocksHTML } from './dashboard.js';
import { act, actOn, stop } from './actions.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The period Week view is on: the one holding the focus day (today until you pick one). */
export function yearPeriod() {
  const ymd = state.yearFocusDate || formatYmd(new Date());
  return periodForDate(ymd, (state.yearRhythm && state.yearRhythm.workSchedule) || defaultWorkSchedule());
}

/** cells: paintYear() result; sectionLabel: the view caption element (may be null). */
export function renderYearWeek(cells, sectionLabel) {
  if (sectionLabel) sectionLabel.textContent = '';
  if (!state.yearFocusMonday) state.yearFocusMonday = mondayOfYmd(formatYmd(new Date()));
  const period = yearPeriod();
  const weekDates = period.dates;
  const weekLogs = state.yearHourLogs.filter(l => inPeriod(period, l.date, l.startMin, l.endMin));
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
    // The period's season, not the day's: a week that starts in March keeps March's work window.
    const spec = period.spec;
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
        ${act('selectYearHourLog', log.id)}${actOn('dblclick', 'deleteYearHourLog', log.id)}${stop('click', 'dblclick')}
        title="${ esc(formatClock(log.startMin) + '–' + formatClock(log.endMin) + (log.label ? ' · ' + log.label : '')) }">${ esc(formatClock(log.startMin)) } ${ esc(log.label || '') }</button>`;
    }).join('');
    const taskBlocks = ymd ? weekTaskBlocksHTML(ymd, t => {
      const start = parseHHMM(t.start);
      return start != null && inPeriod(period, ymd, start, start + (t.duration || DEFAULT_DURATION));
    }) : '';
    const own = periodHours(period, ymd);
    const outside = [[DAY_START_MIN, own.startMin], [own.endMin, DAY_END_MIN]]
      .filter(([a, b]) => b > a)
      .map(([a, b]) => `<div class="year-week-outside" title="${ period.kind === 'work' ? 'Rest' : 'Work' } hours"
        style="top:${ a / 60 * HOUR_H }px;height:${ (b - a) / 60 * HOUR_H }px"></div>`).join('');
    const series = blocksOnDate(ymd).filter(b => inPeriod(period, ymd, b.startMin, b.endMin)).map(b => `<div class="year-week-series ${ b.rule === 'event' ? 'event' : 'open' }"
        style="${ domainStyleVar(b.domain) }top:${ b.startMin / 60 * HOUR_H }px;height:${ Math.max(14, (b.endMin - b.startMin) / 60 * HOUR_H) }px"
        title="${ esc(b.name) } · ${ esc(formatHHMM(b.startMin)) }–${ esc(formatHHMM(b.endMin)) } · ${ esc(seriesDetails(b)) }">
        <span>${ esc(b.name) }</span></div>`).join('');
    const todayMark = ymd === formatYmd(new Date()) ? ' is-today' : '';
    return `<div class="year-week-col${ todayMark }" data-ymd="${ esc(ymd) }"
      ${actOn('mousedown', 'yearHourDragStart', ymd, '$event')}
      ${actOn('mousemove', 'yearHourDragMove', ymd, '$event')}
      style="height:${ WEEK_COL_H }px;min-height:${ WEEK_COL_H }px">${ lines.join('') }${ protocol }${ season }${ outside }${ series }${ blocks }${ taskBlocks }</div>`;
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
    return `<button type="button" class="year-week-head yc-${ cell.kind }" ${act('markYearWeekDate', ymd)}>
      <span class="wd">${ WEEKDAYS[wd] }</span>
      <span class="dd">${ date ? date.getDate() : '' }</span>
      ${ allDay ? `<span class="allday-row">${ allDay }</span>` : '' }
    </button>`;
  }).join('');
  const cols = weekDates.map(ymd => weekColHtml(ymd)).join('');

  const prevScroll = document.getElementById('year-week-scroll')?.scrollTop;
  const prevScrollX = document.getElementById('year-week-scroll')?.scrollLeft;
  grid.innerHTML = `
    <div class="year-week-frame period-${ period.kind }" data-period="${ period.kind }"
      title="${ period.kind === 'work' ? 'Work week' : 'Rest' } · ${ esc(period.start) } – ${ esc(period.end) }">
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
