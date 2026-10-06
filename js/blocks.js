/** Recurring work-day blocks, activity rules, and 364-day cycle lookup. */
import {
  state, YEAR_DAYS, parseYmd, formatYmd, addDaysLocal, formatHHMM, parseHHMM, uid,
  paintYear, weekdayOfDay, defaultWorkSchedule, workWindowFromMonth, seasonSpec,
} from './state.js';

import { normalizeRepeat, repeatsOn } from './recurring.js';

const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function defaultDayBlocks() {
  return [
    { id: 'deep-work', name: 'Deep work', weekdays: [0, 1, 2, 3, 4], startMin: 9 * 60, endMin: 12 * 60, rule: 'leverage', activity: null },
    { id: 'training', name: 'Training', weekdays: [0, 1, 2, 3, 4], startMin: 12 * 60, endMin: 13 * 60, rule: 'event', activity: null },
  ];
}

export function normalizeDayBlocks(raw) {
  const base = defaultDayBlocks();
  const list = Array.isArray(raw) && raw.length ? raw : base;
  return list.map((b, i) => {
    const rule = b.rule === 'leverage' || b.rule === 'event' || b.rule === 'any' ? b.rule : 'any';
    const activity = ['research', 'communicate', 'act', 'learn'].includes(b.activity) ? b.activity : null;
    let weekdays = Array.isArray(b.weekdays)
      ? b.weekdays.map(n => Math.round(Number(n))).filter(n => n >= 0 && n <= 6)
      : base[0].weekdays;
    if (!weekdays.length) weekdays = [0, 1, 2, 3, 4];
    const startMin = Math.max(0, Math.min(24 * 60 - 30, Math.round(Number(b.startMin)) || 9 * 60));
    let endMin = Math.round(Number(b.endMin));
    if (!Number.isFinite(endMin) || endMin <= startMin) endMin = Math.min(24 * 60, startMin + 60);
    const allDay = rule === 'event' && !!b.allDay;
    return {
      id: b.id ? String(b.id) : `block-${i}`,
      name: String(b.name || 'Block').slice(0, 60),
      weekdays: [...new Set(weekdays)].sort((a, c) => a - c),
      startMin: allDay ? 0 : startMin,
      endMin: allDay ? 24 * 60 : endMin,
      rule,
      activity: rule === 'event' ? null : activity,
      // v9 additions — absent on older data: weekly, work days only, no domain
      domain: b.domain ? String(b.domain) : null,
      projectId: b.projectId ? String(b.projectId) : null,
      repeat: normalizeRepeat(b.repeat),
      workDaysOnly: b.workDaysOnly === undefined ? true : !!b.workDaysOnly,
      allDay,
      ...(b.icsUid ? { icsUid: String(b.icsUid) } : {}),
      ...(b.updatedAt ? { updatedAt: b.updatedAt } : {}),
    };
  });
}

export function dayBlocks() {
  if (!state.yearRhythm) return defaultDayBlocks();
  if (!Array.isArray(state.yearRhythm.dayBlocks) || !state.yearRhythm.dayBlocks.length) {
    state.yearRhythm.dayBlocks = normalizeDayBlocks(null);
  }
  return state.yearRhythm.dayBlocks;
}

export function normalizeActivityRules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(r => {
    const kind = r.kind === 'project' || r.kind === 'domain' || r.kind === 'word' ? r.kind : null;
    const activity = ['research', 'communicate', 'act', 'learn'].includes(r.activity) ? r.activity : null;
    const value = String(r.value || '').trim();
    if (!kind || !activity || !value) return null;
    return { id: r.id ? String(r.id) : uid(), kind, value, activity, ...(r.updatedAt ? { updatedAt: r.updatedAt } : {}) };
  }).filter(Boolean);
}

export function activityRules() {
  if (!Array.isArray(state.activityRules)) state.activityRules = [];
  return state.activityRules;
}

export function cycleDayIndex(anchorYmd, date) {
  const start = parseYmd(anchorYmd);
  const d = date instanceof Date ? date : parseYmd(date);
  if (!start || !d) return null;
  const t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((t0 - start) / 86400000);
  return ((diff % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
}

let paintCache = { key: null, cells: null };

/** paintYear() for the current rhythm, recomputed only when the rhythm settings change. */
function paintedCells() {
  const r = state.yearRhythm;
  const key = JSON.stringify([r.yearStartMonday, r.cycles, r.deepRest, r.vacations, r.workSchedule]);
  if (key !== paintCache.key) paintCache = { key, cells: paintYear(r) };
  return paintCache.cells;
}

export function cellForYmd(ymd) {
  if (!state.yearRhythm) return null;
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null) return null;
  return { idx, cell: paintedCells()[idx] };
}

export function isTaskDay(ymd) {
  const hit = cellForYmd(ymd);
  if (!hit) return false;
  return hit.cell.kind === 'work' || hit.cell.kind === 'sprint';
}

export function weekdayIndex(ymd) {
  const d = parseYmd(ymd);
  if (!d) return null;
  const wd = d.getDay();
  return wd === 0 ? 6 : wd - 1;
}

export function workingWeekdaysForDate(ymd) {
  const d = parseYmd(ymd);
  if (!d || !state.yearRhythm) return [0, 1, 2, 3, 4];
  const sched = state.yearRhythm.workSchedule || defaultWorkSchedule();
  const spec = seasonSpec(sched, workWindowFromMonth(d.getMonth(), sched));
  const days = [];
  for (let i = spec.startWeekday; i <= spec.endWeekday; i++) days.push(i);
  return days.length ? days : [0, 1, 2, 3, 4];
}

function skipped(ymd, blockId) {
  return (state.blockSkips || []).some(s => s.date === ymd && s.blockId === blockId);
}

/** Series occurring on ymd: repeat rule, then work-day filter, then per-date skips. */
export function blocksOnDate(ymd, { includeAllDay = false } = {}) {
  let taskDay = null;
  return dayBlocks().filter(b => {
    if (b.allDay && !includeAllDay) return false;
    if (!repeatsOn(b, ymd) || skipped(ymd, b.id)) return false;
    if (!b.workDaysOnly) return true;
    if (taskDay === null) taskDay = isTaskDay(ymd);
    return taskDay;
  });
}

/** All-day series on ymd (birthdays, holidays) — shown as labels, never in the hour grid. */
export function allDayOnDate(ymd) {
  return blocksOnDate(ymd, { includeAllDay: true }).filter(b => b.allDay);
}

export function taskFitsBlock(task, block) {
  if (!block || block.rule === 'event') return false;
  if (block.rule === 'leverage') return task.lno === 'L';
  return true;
}

export function mondayOfYmd(ymd) {
  const d = parseYmd(ymd) || new Date();
  const wd = d.getDay();
  const back = wd === 0 ? 6 : wd - 1;
  return formatYmd(addDaysLocal(d, -back));
}

export function weekWorkDates(mondayYmd) {
  const mon = mondayOfYmd(mondayYmd);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const ymd = formatYmd(addDaysLocal(parseYmd(mon), i));
    const wd = weekdayIndex(ymd);
    const allowed = workingWeekdaysForDate(ymd);
    if (allowed.includes(wd)) dates.push(ymd);
  }
  return dates;
}

/** Placement options for a task on one date. */
export function placementsFor(task, ymd) {
  const opts = [];
  if (!isTaskDay(ymd)) return opts;
  const blocks = blocksOnDate(ymd);
  blocks.forEach(b => {
    if (taskFitsBlock(task, b) || b.rule === 'event') {
      opts.push({
        id: `in:${b.id}`,
        label: `Inside ${b.name} · ${formatHHMM(b.startMin)}`,
        blockId: b.id,
        replacesBlockId: null,
        start: formatHHMM(b.startMin),
      });
    }
    opts.push({
      id: `instead:${b.id}`,
      label: `Instead of ${b.name}`,
      blockId: null,
      replacesBlockId: b.id,
      start: formatHHMM(b.startMin),
    });
  });
  opts.push({
    id: 'free',
    label: 'Free time',
    blockId: null,
    replacesBlockId: null,
    start: null,
  });
  return opts;
}

export function currentPlacementId(task) {
  if (task.replacesBlockId) return `instead:${task.replacesBlockId}`;
  if (task.blockId) return `in:${task.blockId}`;
  if (task.date && task.start) return 'free';
  return '';
}

export function applyPlacement(task, ymd, placementId, freeStart) {
  const opt = placementsFor(task, ymd).find(o => o.id === placementId);
  if (!opt || !ymd) {
    task.date = null;
    task.start = null;
    task.blockId = null;
    task.replacesBlockId = null;
    return;
  }
  const prevSkip = task.replacesBlockId && task.date
    ? { date: task.date, blockId: task.replacesBlockId }
    : null;
  task.date = ymd;
  task.blockId = opt.blockId;
  task.replacesBlockId = opt.replacesBlockId;
  if (opt.id === 'free') {
    const mins = parseHHMM(freeStart || task.start || '09:00');
    task.start = formatHHMM(mins == null ? 9 * 60 : mins);
  } else {
    task.start = opt.start;
  }
  if (!Array.isArray(state.blockSkips)) state.blockSkips = [];
  if (prevSkip) {
    state.blockSkips = state.blockSkips.filter(s => !(s.date === prevSkip.date && s.blockId === prevSkip.blockId && s.taskId === task.id));
  }
  if (task.replacesBlockId) {
    state.blockSkips = state.blockSkips.filter(s => !(s.date === ymd && s.blockId === task.replacesBlockId));
    state.blockSkips.push({ date: ymd, blockId: task.replacesBlockId, taskId: task.id });
  }
  stampActivityFromBlock(task);
}

export function weekdayName(index) {
  return WEEKDAY_NAMES[index] || 'monday';
}

export function weekdayNameFromYmd(ymd) {
  const i = weekdayIndex(ymd);
  return i == null ? 'monday' : WEEKDAY_NAMES[i];
}

function ruleMatches(rule, task) {
  const v = String(rule.value || '').trim().toLowerCase();
  if (!v) return false;
  if (rule.kind === 'project') {
    const id = String(task.projectId || task.project || '').toLowerCase();
    return id === v || String(task.projectName || '').toLowerCase() === v;
  }
  if (rule.kind === 'domain') return String(task.domain || '').toLowerCase() === v;
  if (rule.kind === 'word') return String(task.name || '').toLowerCase().includes(v);
  return false;
}

export function stampActivityFromBlock(task) {
  if (task.activitySource === 'manual') return;
  const block = task.blockId ? dayBlocks().find(b => b.id === task.blockId) : null;
  if (block && block.rule !== 'event' && block.activity) {
    task.activity = block.activity;
    task.lane = block.activity;
    task.activitySource = 'block';
    return;
  }
  const hit = activityRules().find(r => ruleMatches(r, task));
  if (hit) {
    task.activity = hit.activity;
    task.lane = hit.activity;
    task.activitySource = 'rule';
    return;
  }
  if (!task.activitySource) {
    task.activity = task.activity || 'act';
    task.lane = task.activity;
  }
}

export function suggestRule(task, activity) {
  if (task.projectId || task.project) {
    return { kind: 'project', value: String(task.projectId || task.project), activity, label: 'this project' };
  }
  if (task.domain) {
    return { kind: 'domain', value: String(task.domain), activity, label: 'this domain' };
  }
  const word = String(task.name || '').toLowerCase().split(/[^a-z0-9]+/).find(w => w.length > 3);
  if (word) return { kind: 'word', value: word, activity, label: `the word “${word}”` };
  return null;
}

export function saveActivityRule(suggestion) {
  if (!suggestion) return;
  const rules = activityRules();
  const prev = rules.find(r => r.kind === suggestion.kind && r.value.toLowerCase() === String(suggestion.value).toLowerCase());
  if (prev) {
    prev.activity = suggestion.activity;
    return;
  }
  rules.push({ id: uid(), kind: suggestion.kind, value: suggestion.value, activity: suggestion.activity });
}

export const DAY_INTERVALS = [
  { id: 'start', label: 'Start', focus: 'morning', startMin: 7 * 60, endMin: 11 * 60 },
  { id: 'mid', label: 'Mid', focus: 'noon', startMin: 11 * 60 + 15, endMin: 15 * 60 + 30 },
  { id: 'late', label: 'Late', focus: 'afternoon / evening', startMin: 15 * 60 + 30, endMin: 21 * 60 },
];

export function intervalById(id) {
  return DAY_INTERVALS.find(i => i.id === id) || null;
}

export function intervalForTask(task) {
  if (!task) return '';
  if (intervalById(task.interval)) return task.interval;
  const mins = parseHHMM(task.start || '');
  if (mins == null) return '';
  const hit = DAY_INTERVALS.find(i => mins >= i.startMin && mins < i.endMin);
  return hit ? hit.id : '';
}

function rangesOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function clearReplacesSkip(task) {
  if (!task.replacesBlockId || !task.date) return;
  state.blockSkips = (state.blockSkips || []).filter(s => !(s.date === task.date && s.blockId === task.replacesBlockId && s.taskId === task.id));
}

/** Pick a minute inside the interval. Leverage prefers deep work; other tasks pack around events. */
export function placeInInterval(task, ymd, intervalId) {
  const interval = intervalById(intervalId);
  if (!task) return;
  if (!interval || !ymd) {
    clearReplacesSkip(task);
    task.date = null;
    task.start = null;
    task.interval = null;
    task.blockId = null;
    task.replacesBlockId = null;
    return;
  }
  const dur = Math.max(15, Number(task.duration) || 30);
  const blocks = blocksOnDate(ymd);
  const events = blocks.filter(b => b.rule === 'event');
  const leverage = task.lno === 'L'
    ? blocks.find(b => b.rule === 'leverage' && b.startMin < interval.endMin && b.endMin > interval.startMin)
    : null;
  const occupied = state.tasks
    .filter(t => t.id !== task.id && t.date === ymd && t.start)
    .map(t => {
      const start = parseHHMM(t.start);
      if (start == null) return null;
      return { start, end: start + (Number(t.duration) || 30) };
    })
    .filter(Boolean);

  function free(start) {
    const end = start + dur;
    if (start < interval.startMin || end > interval.endMin) return false;
    if (occupied.some(r => rangesOverlap(start, end, r.start, r.end))) return false;
    if (events.some(b => rangesOverlap(start, end, b.startMin, b.endMin))) return false;
    return true;
  }

  let chosen = null;
  if (leverage) {
    const prefer = Math.max(interval.startMin, leverage.startMin);
    if (free(prefer)) chosen = prefer;
  }
  if (chosen == null) {
    for (let m = interval.startMin; m + dur <= interval.endMin; m += 15) {
      if (free(m)) { chosen = m; break; }
    }
  }
  if (chosen == null) chosen = interval.startMin;

  clearReplacesSkip(task);
  task.date = ymd;
  task.interval = interval.id;
  task.start = formatHHMM(chosen);
  task.replacesBlockId = null;
  task.blockId = leverage && chosen >= leverage.startMin && chosen < leverage.endMin ? leverage.id : null;
  stampActivityFromBlock(task);
}

export function nextWeekdayOnOrAfter(fromDate, weekday) {
  const start = fromDate instanceof Date ? parseYmd(formatYmd(fromDate)) : parseYmd(fromDate);
  if (!start || weekday == null || !Number.isFinite(Number(weekday))) return null;
  const wd = weekdayIndex(formatYmd(start));
  const delta = (Number(weekday) - wd + 7) % 7;
  return formatYmd(addDaysLocal(start, delta));
}

/** Next open work day on that weekday, walking week by week if the first is not a task day. */
export function nextOpenWeekday(fromDate, weekday) {
  let date = nextWeekdayOnOrAfter(fromDate, weekday);
  if (!date) return null;
  const first = date;
  for (let i = 0; i < 8; i++) {
    if (isTaskDay(date)) return date;
    date = formatYmd(addDaysLocal(parseYmd(date), 7));
  }
  return first;
}

/** Open tasks dated in the past move to their next open weekday. The missed date is kept in `missed`. */
export function rollOpenTasksForward(fromDate = new Date()) {
  const today = formatYmd(fromDate instanceof Date ? fromDate : new Date());
  state.tasks.forEach(t => {
    if (!t || t.done || t.status === 'someday' || !t.date || t.date >= today) return;
    const wd = weekdayIndex(t.date);
    if (wd == null) return;
    const next = nextOpenWeekday(fromDate, wd);
    if (!next) return;
    if (!Array.isArray(t.missed)) t.missed = [];
    if (!t.missed.includes(t.date)) t.missed.push(t.date);
    t.date = next;
  });
}

/** Open tasks that rolled forward at least once, most-slipped first. */
export function slippedTasks() {
  return state.tasks
    .filter(t => t && !t.done && t.status !== 'someday' && Array.isArray(t.missed) && t.missed.length)
    .sort((a, b) => b.missed.length - a.missed.length);
}

function ruleKey(task) {
  if (task.projectId || task.project) {
    const value = String(task.projectId || task.project);
    return { kind: 'project', value };
  }
  if (task.domain) return { kind: 'domain', value: String(task.domain) };
  const word = String(task.name || '').toLowerCase().split(/[^a-z0-9]+/).find(w => w.length > 3);
  if (word) return { kind: 'word', value: word };
  return null;
}

/** Upsert activity rules once one activity is a strict majority of at least 3 done tasks. */
export function deriveActivityRules() {
  const groups = new Map();
  state.tasks.forEach(t => {
    if (!t || !t.done || !t.activity) return;
    const key = ruleKey(t);
    if (!key) return;
    const id = key.kind + ':' + key.value.toLowerCase();
    if (!groups.has(id)) groups.set(id, { ...key, counts: {} });
    const g = groups.get(id);
    g.counts[t.activity] = (g.counts[t.activity] || 0) + 1;
  });
  groups.forEach(g => {
    const entries = Object.entries(g.counts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return;
    const [activity, n] = entries[0];
    const second = entries[1] ? entries[1][1] : 0;
    if (n >= 3 && n > second) saveActivityRule({ kind: g.kind, value: g.value, activity });
  });
}

/** Open work days from today forward. A weekday always means the coming date. */
export function upcomingWorkDates(fromDate = new Date(), limit = 5) {
  const start = parseYmd(formatYmd(fromDate)) || new Date();
  const dates = [];
  for (let i = 0; i < 28 && dates.length < limit; i++) {
    const ymd = formatYmd(addDaysLocal(start, i));
    const wd = weekdayIndex(ymd);
    if (!workingWeekdaysForDate(ymd).includes(wd)) continue;
    if (!isTaskDay(ymd)) continue;
    dates.push(ymd);
  }
  return dates;
}

export function thisWeekWorkDates(fromDate = new Date()) {
  return upcomingWorkDates(fromDate);
}
