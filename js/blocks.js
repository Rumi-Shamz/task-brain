/** Recurring work-day blocks, activity rules, and 364-day cycle lookup. */
import {
  state, YEAR_DAYS, parseYmd, formatYmd, addDaysLocal, formatHHMM, parseHHMM, uid,
  paintYear, weekdayOfDay, defaultWorkSchedule, workWindowFromMonth, seasonSpec,
} from './state.js';

const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function defaultDayBlocks() {
  return [
    { id: 'deep-work', name: 'Deep work', weekdays: [0, 1, 2, 3, 4], startMin: 9 * 60, endMin: 12 * 60, rule: 'leverage', activity: null },
    { id: 'training', name: 'Training', weekdays: [0, 1, 2, 3, 4], startMin: 12 * 60, endMin: 13 * 60, rule: 'event', activity: null },
  ];
}

export function normalizeDayBlocks(raw) {
  const base = defaultDayBlocks();
  if (!Array.isArray(raw) || !raw.length) return base;
  return raw.map((b, i) => {
    const rule = b.rule === 'leverage' || b.rule === 'event' || b.rule === 'any' ? b.rule : 'any';
    const activity = ['research', 'communicate', 'act', 'learn'].includes(b.activity) ? b.activity : null;
    let weekdays = Array.isArray(b.weekdays)
      ? b.weekdays.map(n => Math.round(Number(n))).filter(n => n >= 0 && n <= 6)
      : base[0].weekdays;
    if (!weekdays.length) weekdays = [0, 1, 2, 3, 4];
    const startMin = Math.max(0, Math.min(24 * 60 - 30, Math.round(Number(b.startMin)) || 9 * 60));
    let endMin = Math.round(Number(b.endMin));
    if (!Number.isFinite(endMin) || endMin <= startMin) endMin = Math.min(24 * 60, startMin + 60);
    return {
      id: b.id ? String(b.id) : `block-${i}`,
      name: String(b.name || 'Block').slice(0, 40),
      weekdays: [...new Set(weekdays)].sort((a, c) => a - c),
      startMin,
      endMin,
      rule,
      activity: rule === 'event' ? null : activity,
    };
  });
}

export function dayBlocks() {
  if (!state.yearRhythm) return defaultDayBlocks();
  if (!Array.isArray(state.yearRhythm.dayBlocks) || !state.yearRhythm.dayBlocks.length) {
    state.yearRhythm.dayBlocks = defaultDayBlocks();
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
    return { id: r.id ? String(r.id) : uid(), kind, value, activity };
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

export function cellForYmd(ymd) {
  if (!state.yearRhythm) return null;
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null) return null;
  const cells = paintYear(state.yearRhythm);
  return { idx, cell: cells[idx] };
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

export function blocksOnDate(ymd) {
  if (!isTaskDay(ymd)) return [];
  const wd = weekdayIndex(ymd);
  return dayBlocks().filter(b => b.weekdays.includes(wd) && !skipped(ymd, b.id));
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
  const exists = rules.some(r => r.kind === suggestion.kind && r.value.toLowerCase() === suggestion.value.toLowerCase() && r.activity === suggestion.activity);
  if (exists) return;
  rules.push({ id: uid(), kind: suggestion.kind, value: suggestion.value, activity: suggestion.activity });
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
