/**
 * Recurring calendar series: appointments (rule 'event') and task containers ('leverage' | 'any').
 * Pure date logic — no DOM, no state — so it runs in Node tests and in the browser alike.
 *
 * repeat: { freq: 'once' | 'weekly' | 'monthly' | 'yearly', interval, from, until, monthly }
 *   weekly   → block.weekdays (0 = Monday), every `interval` weeks counted from `from`
 *   monthly  → monthly: 'day' (same day of month as `from`) | 'nth' (e.g. 2nd Thursday, or last)
 *   yearly   → same month/day as `from`
 *   once     → only on `from`
 */

export const FREQS = ['once', 'weekly', 'monthly', 'yearly'];
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last' };

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function parseDay(ymd) {
  const m = YMD_RE.exec(String(ymd || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
export function dayString(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
/** 0 = Monday … 6 = Sunday */
export function weekdayOf(d) { return (d.getUTCDay() + 6) % 7; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
/** 1-based week of the month for d's weekday (1 = first Thursday …) */
function nthInMonth(d) { return Math.floor((d.getUTCDate() - 1) / 7) + 1; }
function isLastInMonth(d) { return d.getUTCDate() + 7 > daysInMonth(d.getUTCFullYear(), d.getUTCMonth()); }

/** once / monthly / yearly are anchored on `from`; without it they never occur. */
export function normalizeRepeat(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const freq = FREQS.includes(r.freq) ? r.freq : 'weekly';
  const interval = Math.max(1, Math.min(52, Math.round(Number(r.interval)) || 1));
  const from = parseDay(r.from) ? r.from : null;
  const until = parseDay(r.until) ? r.until : null;
  const out = { freq, interval, from, until };
  if (freq === 'monthly') {
    out.monthly = r.monthly === 'nth' || r.monthly === 'last' ? r.monthly : 'day';
  }
  return out;
}

/** Does the series have an occurrence on ymd? (Ignores skips and work-day filtering.) */
export function repeatsOn(block, ymd) {
  const d = parseDay(ymd);
  if (!d || !block) return false;
  const r = block.repeat || { freq: 'weekly', interval: 1 };
  if (r.from && ymd < r.from) return false;
  if (r.until && ymd > r.until) return false;
  const from = parseDay(r.from);
  const interval = r.interval || 1;
  if (r.freq === 'once') return !!r.from && ymd === r.from;
  if (r.freq === 'weekly') {
    if (!(block.weekdays || []).includes(weekdayOf(d))) return false;
    if (interval === 1 || !from) return true;
    const monday = x => x.getTime() - weekdayOf(x) * 864e5;
    const weeks = Math.round((monday(d) - monday(from)) / (7 * 864e5));
    return weeks % interval === 0;
  }
  if (!from) return false;
  if (r.freq === 'monthly') {
    const months = (d.getUTCFullYear() - from.getUTCFullYear()) * 12 + d.getUTCMonth() - from.getUTCMonth();
    if (months % interval !== 0) return false;
    if (r.monthly === 'nth') return weekdayOf(d) === weekdayOf(from) && nthInMonth(d) === nthInMonth(from);
    if (r.monthly === 'last') return weekdayOf(d) === weekdayOf(from) && isLastInMonth(d);
    return d.getUTCDate() === from.getUTCDate();
  }
  if (r.freq === 'yearly') {
    const years = d.getUTCFullYear() - from.getUTCFullYear();
    return years % interval === 0 && d.getUTCMonth() === from.getUTCMonth() && d.getUTCDate() === from.getUTCDate();
  }
  return false;
}

/** Plain-language summary for lists: "Every Tue, Thu", "Every 2 weeks on Mon", "Monthly on the 2nd Thu". */
export function describeRepeat(block) {
  const r = block.repeat || { freq: 'weekly', interval: 1 };
  const from = parseDay(r.from);
  const every = (n, unit) => (n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`);
  let text;
  if (r.freq === 'once') text = r.from ? `Once on ${r.from}` : 'Once (pick a date)';
  else if (r.freq === 'weekly') {
    const days = (block.weekdays || []).map(i => WEEKDAY_SHORT[i]).join(', ') || 'no days';
    text = r.interval > 1 ? `Every ${r.interval} weeks on ${days}` : `Every ${days}`;
  } else if (!from) text = `${r.freq} (pick a start date)`;
  else if (r.freq === 'monthly') {
    const on = r.monthly === 'nth' ? `the ${ORDINAL[nthInMonth(from)]} ${WEEKDAY_SHORT[weekdayOf(from)]}`
      : r.monthly === 'last' ? `the last ${WEEKDAY_SHORT[weekdayOf(from)]}`
      : `day ${from.getUTCDate()}`;
    text = `${every(r.interval, 'month')} on ${on}`;
  } else {
    text = `${every(r.interval, 'year')} on ${MONTH_SHORT[from.getUTCMonth()]} ${from.getUTCDate()}`;
  }
  if (r.until) text += ` until ${r.until}`;
  return text;
}

/** Hover text for a series on the calendars: repeat rule, then location and notes when present. */
export function seriesDetails(block) {
  return [describeRepeat(block), block.location, block.note && block.note.slice(0, 300)].filter(Boolean).join(' · ');
}

/** Labels for the monthly options of a given start date, for the editor. */
export function monthlyChoices(fromYmd) {
  const d = parseDay(fromYmd);
  if (!d) return [{ id: 'day', label: 'Same day each month' }];
  const wd = WEEKDAY_SHORT[weekdayOf(d)];
  const out = [
    { id: 'day', label: `Day ${d.getUTCDate()}` },
    { id: 'nth', label: `${ORDINAL[nthInMonth(d)]} ${wd}` },
  ];
  if (isLastInMonth(d)) out.push({ id: 'last', label: `Last ${wd}` });
  return out;
}

/** Next occurrence on or after fromYmd, scanning up to `horizon` days. */
export function nextOccurrence(block, fromYmd, horizon = 400) {
  const start = parseDay(fromYmd);
  if (!start) return null;
  for (let i = 0; i <= horizon; i++) {
    const ymd = dayString(new Date(start.getTime() + i * 864e5));
    if (repeatsOn(block, ymd)) return ymd;
  }
  return null;
}
