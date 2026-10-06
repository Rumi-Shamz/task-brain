/**
 * iCalendar (.ics) ⇄ recurring series. Covers what a Google Calendar export contains:
 * VEVENT with DTSTART/DTEND/DURATION, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, BYDAY,
 * BYMONTHDAY, UNTIL, COUNT), EXDATE, all-day dates, TZID (taken as local wall time) and UTC times.
 * Pure — no DOM, no state.
 */
import { parseDay, dayString, weekdayOf } from './recurring.js';

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const pad2 = n => String(n).padStart(2, '0');

function unfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(v, { keepLines = false } = {}) {
  return String(v || '').replace(/\\n/gi, keepLines ? '\n' : ' ').replace(/\\([,;\\])/g, '$1').trim();
}

/** "20261006T190000Z" | "20261006T190000" | "20261006" → { ymd, min, allDay } in local time */
export function parseIcsDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(value || '').trim());
  if (!m) return null;
  if (!m[4] || params.VALUE === 'DATE') return { ymd: `${m[1]}-${m[2]}-${m[3]}`, min: 0, allDay: true };
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    return {
      ymd: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
      min: d.getHours() * 60 + d.getMinutes(),
      allDay: false,
    };
  }
  return { ymd: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5], allDay: false };
}

function parseDuration(v) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(String(v || ''));
  if (!m) return null;
  return (+(m[1] || 0) * 7 * 1440) + (+(m[2] || 0) * 1440) + (+(m[3] || 0) * 60) + +(m[4] || 0);
}

function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const [name, ...paramParts] = line.slice(0, colon).split(';');
  const params = {};
  paramParts.forEach(p => { const [k, v] = p.split('='); params[String(k).toUpperCase()] = v; });
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

export function parseIcs(text) {
  const events = [];
  let cur = null;
  unfold(text).forEach(raw => {
    const line = parseLine(raw);
    if (!line) return;
    if (line.name === 'BEGIN' && line.value === 'VEVENT') { cur = { exdates: [] }; return; }
    if (line.name === 'END' && line.value === 'VEVENT') { if (cur) events.push(cur); cur = null; return; }
    if (!cur) return;
    if (line.name === 'SUMMARY') cur.summary = unescapeText(line.value);
    else if (line.name === 'DESCRIPTION') cur.description = unescapeText(line.value, { keepLines: true });
    else if (line.name === 'LOCATION') cur.location = unescapeText(line.value);
    else if (line.name === 'URL') cur.url = line.value.trim();
    else if (line.name === 'UID') cur.uid = line.value.trim();
    else if (line.name === 'DTSTART') cur.start = parseIcsDate(line.value, line.params);
    else if (line.name === 'DTEND') cur.end = parseIcsDate(line.value, line.params);
    else if (line.name === 'DURATION') cur.durationMin = parseDuration(line.value);
    else if (line.name === 'RRULE') {
      cur.rrule = {};
      line.value.split(';').forEach(kv => { const [k, v] = kv.split('='); cur.rrule[k.toUpperCase()] = v; });
    } else if (line.name === 'EXDATE') {
      line.value.split(',').forEach(v => { const d = parseIcsDate(v, line.params); if (d) cur.exdates.push(d.ymd); });
    } else if (line.name === 'RECURRENCE-ID') cur.isOverride = true;
    else if (line.name === 'STATUS') cur.status = line.value.trim().toUpperCase();
  });
  return events;
}

function addDays(ymd, n) {
  return dayString(new Date(parseDay(ymd).getTime() + n * 864e5));
}

/** RRULE COUNT → an approximate UNTIL so the series stops near where the source said. */
function untilFromCount(rule, startYmd, perPeriod) {
  const count = Math.max(1, +rule.COUNT);
  const interval = Math.max(1, +(rule.INTERVAL || 1));
  const periods = Math.ceil(count / Math.max(1, perPeriod)) - 1;
  const d = parseDay(startYmd);
  if (rule.FREQ === 'DAILY') return addDays(startYmd, (count - 1) * interval);
  if (rule.FREQ === 'WEEKLY') return addDays(startYmd, periods * interval * 7 + 6);
  if (rule.FREQ === 'MONTHLY') return dayString(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + periods * interval + 1, 0)));
  return dayString(new Date(Date.UTC(d.getUTCFullYear() + periods * interval, 11, 31)));
}

/**
 * Turn parsed VEVENTs into series. Past one-off events, cancelled events, edited single
 * occurrences and series that ended before `todayYmd` are skipped and counted.
 * @returns {{ series: object[], skipped: Record<string, number> }}
 */
export function eventsToSeries(events, { todayYmd, domain = null } = {}) {
  const series = [];
  const skipped = {};
  const skip = why => { skipped[why] = (skipped[why] || 0) + 1; };
  events.forEach(ev => {
    if (!ev.start || !ev.summary) return skip('no start or title');
    if (ev.status === 'CANCELLED') return skip('cancelled');
    if (ev.isOverride) return skip('edited single occurrence');
    const startYmd = ev.start.ymd;
    let endMin = ev.end && ev.end.ymd === startYmd ? ev.end.min : ev.start.min + (ev.durationMin || 60);
    if (ev.start.allDay) endMin = 24 * 60;
    endMin = Math.min(24 * 60, Math.max(ev.start.min + 15, endMin));
    const base = {
      name: ev.summary.slice(0, 60),
      rule: 'event',
      activity: null,
      domain,
      allDay: !!ev.start.allDay,
      startMin: ev.start.allDay ? 0 : ev.start.min,
      endMin: ev.start.allDay ? 24 * 60 : endMin,
      workDaysOnly: false,
      weekdays: [weekdayOf(parseDay(startYmd))],
      exdates: ev.exdates.filter(d => d >= (todayYmd || '')),
      icsUid: ev.uid || null,
      note: (ev.description || '').slice(0, 2000),
      location: (ev.location || '').slice(0, 200),
      url: /^https?:\/\//i.test(ev.url || '') ? ev.url : '',
    };
    const r = ev.rrule;
    if (!r) {
      if (todayYmd && startYmd < todayYmd) return skip('past one-off');
      series.push({ ...base, repeat: { freq: 'once', interval: 1, from: startYmd, until: null } });
      return;
    }
    const interval = Math.max(1, Math.min(52, +(r.INTERVAL || 1)));
    const byday = String(r.BYDAY || '').split(',').filter(Boolean);
    const repeat = { freq: 'weekly', interval, from: startYmd, until: null };
    let weekdays = base.weekdays;
    if (r.FREQ === 'DAILY') {
      if (interval > 1) return skip('every N days');
      weekdays = [0, 1, 2, 3, 4, 5, 6];
    } else if (r.FREQ === 'WEEKLY') {
      const days = byday.map(b => BYDAY.indexOf(b.slice(-2))).filter(i => i >= 0);
      if (days.length) weekdays = [...new Set(days)].sort();
    } else if (r.FREQ === 'MONTHLY') {
      repeat.freq = 'monthly';
      const pos = byday.length === 1 ? /^(-?\d)?([A-Z]{2})$/.exec(byday[0]) : null;
      repeat.monthly = pos && pos[1] === '-1' ? 'last' : pos ? 'nth' : 'day';
    } else if (r.FREQ === 'YEARLY') {
      repeat.freq = 'yearly';
    } else {
      return skip(`unsupported rule ${r.FREQ}`);
    }
    if (r.UNTIL) repeat.until = (parseIcsDate(r.UNTIL) || {}).ymd || null;
    else if (r.COUNT) repeat.until = untilFromCount(r, startYmd, r.FREQ === 'WEEKLY' ? weekdays.length : 1);
    if (todayYmd && repeat.until && repeat.until < todayYmd) return skip('series already ended');
    series.push({ ...base, weekdays, repeat });
  });
  return { series, skipped };
}

function icsDate(ymd) { return ymd.replace(/-/g, ''); }
function icsDateTime(ymd, min) { return `${icsDate(ymd)}T${pad2(Math.floor(min / 60))}${pad2(min % 60)}00`; }
function escapeText(v) { return String(v || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }

/** Series → .ics text (floating local times). `skips` are { date, blockId } pairs to export as EXDATE. */
export function seriesToIcs(list, { skips = [], domainLabel = d => d, stampYmd } = {}) {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//task-brain//recurring//EN', 'CALSCALE:GREGORIAN'];
  const stamp = `${icsDate(stampYmd || dayString(new Date()))}T000000Z`;
  list.forEach(b => {
    const r = b.repeat || { freq: 'weekly', interval: 1 };
    const from = r.from || stampYmd || dayString(new Date());
    out.push('BEGIN:VEVENT', `UID:${b.icsUid || `${b.id}@task-brain`}`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(b.name)}`);
    if (b.allDay) {
      out.push(`DTSTART;VALUE=DATE:${icsDate(from)}`, `DTEND;VALUE=DATE:${icsDate(addDays(from, 1))}`);
    } else {
      out.push(`DTSTART:${icsDateTime(from, b.startMin)}`, `DTEND:${icsDateTime(from, b.endMin)}`);
    }
    if (b.domain) out.push(`CATEGORIES:${escapeText(domainLabel(b.domain))}`);
    if (b.note) out.push(`DESCRIPTION:${escapeText(b.note)}`);
    if (b.location) out.push(`LOCATION:${escapeText(b.location)}`);
    if (b.url) out.push(`URL:${b.url}`);
    const parts = [];
    if (r.freq === 'weekly') parts.push('FREQ=WEEKLY', `BYDAY=${(b.weekdays || []).map(i => BYDAY[i]).join(',')}`);
    else if (r.freq === 'monthly') {
      const d = parseDay(from);
      if (r.monthly === 'nth') parts.push('FREQ=MONTHLY', `BYDAY=${Math.floor((d.getUTCDate() - 1) / 7) + 1}${BYDAY[weekdayOf(d)]}`);
      else if (r.monthly === 'last') parts.push('FREQ=MONTHLY', `BYDAY=-1${BYDAY[weekdayOf(d)]}`);
      else parts.push('FREQ=MONTHLY', `BYMONTHDAY=${d.getUTCDate()}`);
    } else if (r.freq === 'yearly') parts.push('FREQ=YEARLY');
    if (parts.length) {
      if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
      if (r.until) parts.push(`UNTIL=${icsDate(r.until)}`);
      out.push(`RRULE:${parts.join(';')}`);
    }
    const ex = [...new Set([...(b.exdates || []), ...skips.filter(s => s.blockId === b.id).map(s => s.date)])];
    if (ex.length) {
      out.push(b.allDay
        ? `EXDATE;VALUE=DATE:${ex.map(icsDate).join(',')}`
        : `EXDATE:${ex.map(d => icsDateTime(d, b.startMin)).join(',')}`);
    }
    out.push('END:VEVENT');
  });
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}
