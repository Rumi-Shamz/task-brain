/**
 * Plan → Week shows one period at a time: a work week or the rest between two work weeks.
 * Both come from the season's work window (e.g. Mon 12:00 → Fri 12:00): the work period runs from
 * its start day to its end day, the rest period from that end day to the next start day. The two
 * boundary days appear in both, each showing only its own hours. So a year has 2 × 52 periods.
 */
import { addDaysLocal, defaultWorkSchedule, formatYmd, parseYmd, seasonSpec, workWindowFromMonth } from './state.js';

const DAY_MIN = 24 * 60;

function weekdayOf(date) {
  const wd = date.getDay();
  return wd === 0 ? 6 : wd - 1;
}

/** Day the work window opens on, on or before `date`, and the season spec that week runs on. */
function workWeekStart(date, schedule) {
  // The start weekday is read from the date's own season first; a week keeps the season of its start day.
  const guess = seasonSpec(schedule, workWindowFromMonth(date.getMonth(), schedule));
  let start = addDaysLocal(date, -((weekdayOf(date) - guess.startWeekday + 7) % 7));
  let spec = seasonSpec(schedule, workWindowFromMonth(start.getMonth(), schedule));
  if (spec.startWeekday !== guess.startWeekday) {
    start = addDaysLocal(date, -((weekdayOf(date) - spec.startWeekday + 7) % 7));
    spec = seasonSpec(schedule, workWindowFromMonth(start.getMonth(), schedule));
  }
  return { start, spec };
}

function build(kind, start, spec) {
  const workDays = Math.max(0, (spec.endWeekday - spec.startWeekday + 7) % 7);
  const first = kind === 'work' ? start : addDaysLocal(start, workDays);
  const last = kind === 'work' ? addDaysLocal(start, workDays) : addDaysLocal(start, 7);
  const dates = [];
  for (let d = first; formatYmd(d) <= formatYmd(last); d = addDaysLocal(d, 1)) dates.push(formatYmd(d));
  const openMin = kind === 'work' ? spec.startHour * 60 : spec.endHour * 60;
  const closeMin = kind === 'work' ? spec.endHour * 60 : spec.startHour * 60;
  return { kind, dates, start: dates[0], end: dates[dates.length - 1], openMin, closeMin, weekStart: formatYmd(start), spec };
}

/**
 * The period that `ymd` belongs to. The work start day (Monday) opens the work view, the work end
 * day (Friday in the long season, Thursday in the short one) opens the rest view.
 * Returns { kind: 'work'|'rest', dates, start, end, openMin, closeMin, weekStart, spec }.
 */
export function periodForDate(ymd, schedule = defaultWorkSchedule()) {
  const date = parseYmd(ymd) || new Date();
  const { start, spec } = workWeekStart(date, schedule);
  const offset = Math.round((date - start) / 86400000);
  const workDays = Math.max(1, (spec.endWeekday - spec.startWeekday + 7) % 7);
  return build(offset < workDays ? 'work' : 'rest', start, spec);
}

/** Next (dir 1) or previous (dir -1) period: work → rest → work. */
export function stepPeriod(period, dir, schedule = defaultWorkSchedule()) {
  const weekStart = parseYmd(period.weekStart);
  if (dir > 0) {
    if (period.kind === 'work') return build('rest', weekStart, period.spec);
    return periodForDate(formatYmd(addDaysLocal(weekStart, 7)), schedule);
  }
  if (period.kind === 'rest') return build('work', weekStart, period.spec);
  const prev = workWeekStart(addDaysLocal(weekStart, -7), schedule);
  return build('rest', prev.start, prev.spec);
}

/**
 * Minutes of `ymd` that belong to the period, as { startMin, endMin }. The first day opens at
 * openMin, the last closes at closeMin, days in between are whole.
 */
export function periodHours(period, ymd) {
  const startMin = ymd === period.start ? period.openMin : 0;
  const endMin = ymd === period.end ? period.closeMin : DAY_MIN;
  return { startMin, endMin: Math.max(startMin, endMin) };
}

/** Whether a stretch of `ymd` (minutes from midnight) falls inside the period. */
export function inPeriod(period, ymd, startMin, endMin = startMin) {
  if (!period.dates.includes(ymd)) return false;
  const h = periodHours(period, ymd);
  return startMin < h.endMin && Math.max(endMin, startMin + 1) > h.startMin;
}
