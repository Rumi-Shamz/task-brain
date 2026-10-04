import { deps } from './deps.js';

// Shared mutable app state
export const state = {
  tasks: [],
  groups: [],
  groupCounter: 0,
  planWizardIndex: 0,
  planEditId: null,
  dashActivityFilter: 'all',
  dashEditId: null,
  customDomains: [],
  collapsedDomains: null,
  schedule: [],
  dragSrc: null,
  yearRhythm: null,
  yearHourLogs: [],
  yearCalendarView: 'year',
  yearWeekMonday: 0,
  yearFocusMonday: null,
  activityRules: [],
  blockSkips: [],
  ruleOffer: null,
  yearMonthCursor: { year: new Date().getFullYear(), month: new Date().getMonth() },
  yearOverviewYear: null,
  yearSelectedLogId: null,
  yearHourDrag: null,
  dashDragId: null,
  calPointer: null,
  dashCalDate: null,
  hideDone: false,
  timerTickId: null,
  customProjects: [],
  projects: [],
  skills: [],
  dayCalScrolledOnce: false,
  yearWeekScrolledOnce: false,
  dashMobileScreen: 'day', // 'day' | 'board' — mobile dashboard split
  yearMobileDay: 0, // 0–6 offset within current week (mobile week day picker)
  ghPushTimer: null,
  fileSha: null,
  ghSaving: false,
  /** boot: waiting for first pull; ready: may auto-push; blocked: pull failed; local: no GitHub */
  syncGate: 'boot',
  lastSyncAt: null,
};

export const BUILTIN_PROJECTS = [
  { id: 'swing-shuffle', label: 'Swing&Shuffle' },
  { id: 'alfa', label: 'ALFA' },
  { id: 'dorst', label: 'Dorst' },
  { id: 'personal', label: 'Personal' },
];
export const PROJECT_PALETTE = ['#7F77DD', '#D4537E', '#5B8DEF', '#C17A3A', '#2A9D8F', '#E76F51', '#9B59B6', '#16A085'];
export const LANES = [
  { id: 'research', label: 'Research / Plan' },
  { id: 'communicate', label: 'Communicate' },
  { id: 'act', label: 'Act' },
  { id: 'learn', label: 'Learn' },
];
export const CAL_DAY_START = 0;
export const CAL_DAY_END = 24 * 60;
export const CAL_SNAP = 15;
export const CAL_MIN_DURATION = 15;
export const DEFAULT_DURATION = 30;
export const HOUR_H = 36;
export const VIEW_HOUR_START = 6;
export const VIEW_HOUR_END = 22;
export const VIEW_HOURS = VIEW_HOUR_END - VIEW_HOUR_START;

export const YEAR_DAYS = 364;
export const FAST_DAYS = 5;
export const RESTORE_DAYS = 2;
export const SPRINT_DAYS = 14;
export const CYCLE_DAYS = FAST_DAYS + RESTORE_DAYS + SPRINT_DAYS;
export const DEEP_REST_DAYS = 28;
export const VACATION_DAYS = 10;
export const WEEK_HOUR_START = 0;
export const WEEK_HOUR_END = 24;
export const SLOT_MINUTES = 30;
export const DAY_START_MIN = WEEK_HOUR_START * 60;
export const DAY_END_MIN = WEEK_HOUR_END * 60;
export const VISIBLE_MINUTES = DAY_END_MIN - DAY_START_MIN;
export const WEEK_COL_H = 24 * HOUR_H;
export const VIEW_SCROLL_TOP = VIEW_HOUR_START * HOUR_H;

export const BUFFERS = [
  { icon: '☕', label: 'Coffee break', energy: 'up' },
  { icon: '🚶', label: 'Short walk', energy: 'up' },
  { icon: '📓', label: 'Journal 5 min', energy: 'neutral' },
  { icon: '🧘', label: 'Breathe / reset', energy: 'down' },
  { icon: '🎧', label: 'Music break', energy: 'up' },
  { icon: '💧', label: 'Water + stretch', energy: 'neutral' },
  { icon: '👀', label: 'Eyes off screen', energy: 'neutral' },
];

export function allProjects() {
  return BUILTIN_PROJECTS.concat(state.customProjects);
}
export function isBuiltinProject(id) {
  return BUILTIN_PROJECTS.some(p => p.id === id);
}
export function uid() { return Math.random().toString(36).slice(2, 8); }

export function normalizeCustomProjects(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(BUILTIN_PROJECTS.map(p => p.id));
  const out = [];
  list.forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    let id = String(p.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    const label = String(p.label || p.name || '').trim();
    if (!id || !label || seen.has(id)) return;
    seen.add(id);
    const color = String(p.color || PROJECT_PALETTE[i % PROJECT_PALETTE.length]);
    const domain = p.domain || (Array.isArray(p.domains) && p.domains[0]) || 'Personal';
    const domains = Array.isArray(p.domains) && p.domains.length ? p.domains : [domain];
    out.push({ id, label, color, domain, domains });
  });
  return out;
}
export function slugProjectId(label) {
  let base = String(label || '').trim().toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';
  let id = base;
  let n = 2;
  const taken = new Set(allProjects().map(p => p.id));
  while (taken.has(id)) { id = base + '-' + n; n++; }
  return id;
}
export function addCustomProject() {
  const inp = document.getElementById('new-project-input');
  const label = (inp && inp.value || '').trim();
  if (!label) {
    if (inp) { inp.focus(); inp.placeholder = 'Name required…'; }
    return;
  }
  const id = slugProjectId(label);
  const color = PROJECT_PALETTE[state.customProjects.length % PROJECT_PALETTE.length];
  state.customProjects.push({ id, label, color, domain: 'Personal', domains: ['Personal'] });
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!state.projects.some(p => p.id === id)) {
    state.projects.push({ id, name: label, domain: 'Personal', domains: ['Personal'], objective: '', deadline: null, status: 'active', people: [], links: [], color });
  }
  if (inp) { inp.value = '';
    inp.placeholder = 'New project…'; }
  deps.save();
  deps.switchPhase('dashboard');
  deps.renderDashboard();
  const col = document.querySelector(`.project-col[data-project="${ CSS.escape(id) }"]`);
  if (col) col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}
export function projectClass(project) {
  if (!project) return 'proj-none';
  if (isBuiltinProject(project)) return 'proj-' + project;
  return 'proj-custom';
}
export function projectCssVars(project) {
  if (!project || isBuiltinProject(project)) return '';
  const p = state.customProjects.find(x => x.id === project);
  if (!p || !p.color) return '';
  return `--pc:${ esc(p.color) };`;
}
export function projectColStyleAttr(project) {
  const vars = projectCssVars(project);
  return vars ? ` style="${ vars }"` : '';
}

export function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function pad2(n) { return String(n).padStart(2, '0'); }
export function formatYmd(d) {
  return `${ d.getFullYear() }-${ pad2(d.getMonth() + 1) }-${ pad2(d.getDate()) }`;
}
export function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function addDaysLocal(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return x;
}
export function mondayOnOrBefore(d) {
  const day = d.getDay();
  const back = day === 0 ? 6 : day - 1;
  return addDaysLocal(d, -back);
}
export function defaultYearStartMonday() {
  const jan1 = new Date(new Date().getFullYear(), 0, 1);
  const day = jan1.getDay();
  const forward = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  return formatYmd(addDaysLocal(jan1, forward));
}
export function clampDay(n) { return Math.max(0, Math.min(YEAR_DAYS - 1, n | 0)); }
export function weekdayOfDay(day) { return ((day % 7) + 7) % 7; }
export function weekdayTarget(w) { return w === 'thu' ? 3 : 4; }
export function snapToWeekday(day, w) {
  const target = weekdayTarget(w);
  const cur = weekdayOfDay(day);
  let delta = target - cur;
  if (delta > 3) delta -= 7;
  if (delta < -3) delta += 7;
  return clampDay(day + delta);
}
export function seedYearRhythm(anchor) {
  return {
    version: 1,
    yearStartMonday: anchor || defaultYearStartMonday(),
    cycles: [{ startDay: 7 }, { startDay: 98 }, { startDay: 189 }, { startDay: 280 }],
    deepRest: { startDay: 231 },
    vacations: [
      { startDay: 32, startWeekday: 'fri' },
      { startDay: 123, startWeekday: 'fri' },
      { startDay: 263, startWeekday: 'fri' },
      { startDay: 319, startWeekday: 'fri' },
    ],
    hourLogs: [],
    workSchedule: defaultWorkSchedule(),
  };
}
export function newHourLogId() {
  return 'hl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}
export function normalizeHourLogs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (!item || typeof item !== 'object') return null;
    const date = String(item.date || '');
    if (!parseYmd(date)) return null;
    let startMin = Math.round(Number(item.startMin));
    let endMin = Math.round(Number(item.endMin));
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
    startMin = Math.max(0, Math.min(24 * 60 - 1, startMin));
    endMin = Math.max(startMin + SLOT_MINUTES, Math.min(24 * 60, endMin));
    return { id: item.id ? String(item.id) : newHourLogId(), date, startMin, endMin, label: item.label ? String(item.label) : undefined };
  }).filter(Boolean);
}
export function formatClock(min) {
  return `${ pad2(Math.floor(min / 60)) }:${ pad2(min % 60) }`;
}
export function hoursBetween(a, b) { return Math.max(0, (b - a) / 60); }
export function snapMin(min) { return Math.round(min / SLOT_MINUTES) * SLOT_MINUTES; }
export function clampVisibleMin(min) { return Math.max(DAY_START_MIN, Math.min(DAY_END_MIN, min)); }
export const WEEKDAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const MONTH_SHORT_WS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function defaultWorkSchedule() {
  return {
    long: { months: [8,9,10,11,0,1,2], startWeekday: 0, startHour: 12, endWeekday: 4, endHour: 12 },
    short: { months: [3,4,5,6,7], startWeekday: 0, startHour: 12, endWeekday: 3, endHour: 12 },
  };
}
export function clampHour(n) { return Math.max(0, Math.min(23, Math.round(Number(n)) || 0)); }
export function clampWeekdayIdx(n) { return Math.max(0, Math.min(6, Math.round(Number(n)) || 0)); }
export function normalizeSeasonSpec(raw, fallback) {
  if (!raw || typeof raw !== 'object') return { ...fallback, months: [...fallback.months] };
  let months = [];
  if (Array.isArray(raw.months)) { months = raw.months.map(m => Math.round(Number(m))).filter(m => m >= 0 && m <= 11); } else if (raw.fromMonth != null && raw.toMonth != null) {
    const fromM = Math.max(0, Math.min(11, Math.round(Number(raw.fromMonth)) || 0));
    const toM = Math.max(0, Math.min(11, Math.round(Number(raw.toMonth)) || 0));
    let m = fromM;
    for (let i = 0; i < 12; i++) { months.push(m); if (m === toM) break; m = (m + 1) % 12; }
  }
  if (!months.length) months = [...fallback.months];
  return { months: [...new Set(months)].sort((a,b) => a - b), startWeekday: clampWeekdayIdx(raw.startWeekday ?? fallback.startWeekday), startHour: clampHour(raw.startHour ?? fallback.startHour), endWeekday: clampWeekdayIdx(raw.endWeekday ?? fallback.endWeekday), endHour: clampHour(raw.endHour ?? fallback.endHour) };
}
export function normalizeWorkSchedule(raw) {
  const base = defaultWorkSchedule();
  if (!raw || typeof raw !== 'object') return base;
  return { long: normalizeSeasonSpec(raw.long, base.long), short: normalizeSeasonSpec(raw.short, base.short) };
}
export function workWindowFromMonth(monthIndex, schedule) {
  return schedule.short.months.includes(monthIndex) ? 'short' : 'long';
}
export function seasonSpec(schedule, window) {
  return (schedule || defaultWorkSchedule())[window];
}
export function hourLabel(h) {
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return pad2(h) + ':00';
}
export function monthsLabel(months) {
  if (!months.length) return '—';
  const names = months.map(m => MONTH_SHORT_WS[m]);
  const sorted = [...months].sort((a,b) => a - b);
  let contiguous = true;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i-1] + 1) { contiguous = false; break; }
  if (contiguous) return names[0] + (names.length > 1 ? '–' + names[names.length-1] : '');
  if (sorted[0] === 0 && sorted[sorted.length-1] === 11) {
    let gapAt = -1;
    for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i-1] + 1) { gapAt = sorted[i-1] + 1; break; }
    if (gapAt >= 0) {
      const afterGap = sorted.find(m => m > gapAt) ?? sorted[0];
      return MONTH_SHORT_WS[afterGap] + '–' + MONTH_SHORT_WS[gapAt - 1];
    }
  }
  return names[0] + '–' + names[names.length - 1];
}
export function workWindowLabel(spec) {
  return 'work to ' + WEEKDAY_SHORT[spec.endWeekday] + ' ' + hourLabel(spec.endHour);
}
export function workWindowRuleText(spec) {
  return monthsLabel(spec.months) + ' · ' + WEEKDAY_SHORT[spec.startWeekday] + ' ' + hourLabel(spec.startHour)
    + ' → ' + WEEKDAY_SHORT[spec.endWeekday] + ' ' + hourLabel(spec.endHour);
}
export function seasonalWorkShadeRange(kind, weekday, spec) {
  if (kind !== 'work') return null;
  if (weekday < spec.startWeekday || weekday > spec.endWeekday) return null;
  const startMin = spec.startHour * 60;
  const endMin = spec.endHour * 60;
  if (spec.startWeekday === spec.endWeekday) {
    return { startMin, endMin: Math.max(endMin, startMin + SLOT_MINUTES) };
  }
  if (weekday === spec.startWeekday) return { startMin, endMin: DAY_END_MIN };
  if (weekday === spec.endWeekday) return { startMin: DAY_START_MIN, endMin };
  return { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
}
/** Aggregation only — painting rules unchanged. */
export function statsBuckets(counts) {
  return { work: (counts.work || 0) + (counts.sprint || 0), free: (counts.free || 0) + (counts.vacation || 0), reset: (counts.fast || 0) + (counts.restore || 0) + (counts.deepRest || 0), conflict: counts.conflict || 0 };
}
export function mondayOfWeek(day) {
  return clampDay(day - weekdayOfDay(day));
}
export function dateForDay(anchorYmd, day) {
  const start = parseYmd(anchorYmd);
  if (!start) return null;
  return addDaysLocal(start, day);
}
export function normalizeRhythm(raw) {
  const base = seedYearRhythm();
  if (!raw || raw.version !== 1) return base;
  const anchor = parseYmd(raw.yearStartMonday);
  const yearStartMonday = formatYmd(mondayOnOrBefore(anchor || parseYmd(defaultYearStartMonday())));
  const cycles = Array.isArray(raw.cycles) && raw.cycles.length === 4
    ? raw.cycles.map(c => ({ startDay: clampDay(c.startDay) }))
    : base.cycles;
  const deepRest = raw.deepRest
    ? { startDay: clampDay(raw.deepRest.startDay) }
    : base.deepRest;
  const vacations = Array.isArray(raw.vacations) && raw.vacations.length === 4
    ? raw.vacations.map(v => {
        const startWeekday = v.startWeekday === 'thu' ? 'thu' : 'fri';
        return { startWeekday, startDay: snapToWeekday(clampDay(v.startDay), startWeekday) };
      })
    : base.vacations;
  return {
    version: 1, yearStartMonday, cycles, deepRest, vacations,
    workSchedule: normalizeWorkSchedule(raw.workSchedule),
    dayBlocks: Array.isArray(raw.dayBlocks) ? raw.dayBlocks : null,
  };
}
export function rhythmWithHours() {
  return { ...state.yearRhythm, hourLogs: state.yearHourLogs };
}
export function paintYear(rhythm) {
  const cells = Array.from({ length: YEAR_DAYS }, (_, day) => ({ day, kind: null, labels: [] }));
  const mark = (start, len, kind, label) => {
    for (let i = 0; i < len; i++) {
      const d = start + i;
      if (d < 0 || d >= YEAR_DAYS) continue;
      if (cells[d].kind && cells[d].kind !== kind) { cells[d].kind = 'conflict';
        cells[d].labels.push(label); } else { cells[d].kind = kind;
        cells[d].labels.push(label); }
    }
  };
  rhythm.cycles.forEach((c, i) => {
    const n = i + 1;
    mark(c.startDay, FAST_DAYS, 'fast', `C${ n } fast`);
    mark(c.startDay + FAST_DAYS, RESTORE_DAYS, 'restore', `C${ n } restore`);
    mark(c.startDay + FAST_DAYS + RESTORE_DAYS, SPRINT_DAYS, 'sprint', `C${ n } sprint`);
  });
  mark(rhythm.deepRest.startDay, DEEP_REST_DAYS, 'deepRest', 'Deep rest');
  rhythm.vacations.forEach((v, i) => {
    mark(snapToWeekday(v.startDay, v.startWeekday), VACATION_DAYS, 'vacation', `Vac ${ i + 1 }`);
  });
  for (const cell of cells) {
    if (cell.kind === 'conflict') continue;
    if (cell.kind) continue;
    const date = dateForDay(rhythm.yearStartMonday, cell.day);
    if (!date) { cell.kind = 'free'; continue; }
    const workSched = rhythm.workSchedule || defaultWorkSchedule();
    const window = workWindowFromMonth(date.getMonth(), workSched);
    const spec = seasonSpec(workSched, window);
    const wd = weekdayOfDay(cell.day);
    if (wd >= spec.startWeekday && wd <= spec.endWeekday) { cell.kind = 'work';
      cell.labels = [workWindowLabel(spec)]; } else { cell.kind = 'free';
      cell.labels = ['off']; }
  }
  return cells;
}
export function dayIndexToday(rhythm) {
  const start = parseYmd(rhythm.yearStartMonday);
  if (!start) return null;
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((t0 - start) / 86400000);
  return ((diff % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
}


export function normalizeTask(t) {
  const done = !!t.done;
  let status = t.status || (done ? 'done' : 'todo');
  if (!['todo', 'done', 'someday'].includes(status)) status = done ? 'done' : 'todo';
  return {
    ...t,
    project: t.projectId || t.project || null,
    projectId: t.projectId || t.project || null,
    domain: t.domain ?? null,
    lane: t.activity || t.lane || null,
    activity: t.activity || t.lane || 'act',
    activitySource: t.activitySource === 'manual' || t.activitySource === 'block' || t.activitySource === 'rule'
      ? t.activitySource : null,
    blockId: t.blockId ? String(t.blockId) : null,
    replacesBlockId: t.replacesBlockId ? String(t.replacesBlockId) : null,
    start: t.start ?? null,
    interval: t.interval === 'start' || t.interval === 'mid' || t.interval === 'late' ? t.interval : null,
    duration: t.duration ?? DEFAULT_DURATION,
    date: t.date ?? null,
    subtasks: t.subtasks || [],
    draining: !!t.draining,
    done: status === 'done' || done,
    status,
    reviewAt: t.reviewAt || null,
    priority: t.priority != null ? Number(t.priority) : null,
    timepressure: t.timepressure || null,
    trackedMs: Math.max(0, Number(t.trackedMs) || 0),
    timerStartedAt: t.timerStartedAt != null ? Number(t.timerStartedAt) : null,
    who: t.who != null ? String(t.who) : '',
    note: t.note != null ? String(t.note) : '',
    blockingNote: t.blockingNote != null ? String(t.blockingNote) : '',
    parentId: t.parentId ? String(t.parentId) : null,
    // LNO: migrate legacy lt boolean
    lno: t.lno === 'L' || t.lno === 'N' || t.lno === 'O' ? t.lno
      : t.lt === true ? 'L' : t.lt === false ? 'N' : (t.lno ?? null),
    triaged: !!t.triaged,
  };
}
export function newTask(name, extra) {
  return normalizeTask({
    id: uid(), name, who: '', note: '', blockingNote: '', parentId: null, blocking: null, lt: null, size: null,
    subtasks: [], draining: false, done: false, trackedMs: 0, timerStartedAt: null,
    ...(extra || {}),
  });
}
export function isTopLevelTask(t) {
  return t && !t.parentId;
}
export function childTasksOf(parentId) {
  return state.tasks.filter(t => t.parentId === parentId && t.status !== 'someday');
}
export function taskElapsedMs(t) {
  const base = Math.max(0, Number(t.trackedMs) || 0);
  if (t.timerStartedAt) return base + Math.max(0, Date.now() - t.timerStartedAt);
  return base;
}
export function formatTracked(ms) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
  return m + ':' + pad2(s);
}
export function anyTimerRunning() {
  return state.tasks.some(t => !!t.timerStartedAt);
}
export function ensureTimerTick() {
  if (anyTimerRunning()) {
    if (!state.timerTickId) state.timerTickId = setInterval(refreshRunningTimers, 1000);
  } else if (state.timerTickId) { clearInterval(state.timerTickId);
    state.timerTickId = null; }
}
export function refreshRunningTimers() {
  document.querySelectorAll('[data-timer-display]').forEach(el => {
    const t = state.tasks.find(x => x.id === el.dataset.timerDisplay);
    if (!t) return;
    el.textContent = formatTracked(taskElapsedMs(t));
    el.classList.toggle('running', !!t.timerStartedAt);
  });
  ensureTimerTick();
}
export function setHideDone(v) {
  state.hideDone = !!v;
  const toggle = document.getElementById('hide-done-toggle');
  if (toggle) toggle.checked = state.hideDone;
  deps.renderDashboard();
}
export function toggleTaskDone(id, checked) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const becameDone = !!checked && !t.done;
  t.done = !!checked;
  if (t.done) t.status = 'done';
  else if (t.status === 'done') t.status = 'todo';
  if (t.done && t.timerStartedAt) { t.trackedMs = taskElapsedMs(t);
    t.timerStartedAt = null; }
  if (becameDone && typeof window.onTaskDoneMaybeLearn === 'function') {
    window.onTaskDoneMaybeLearn(t, true);
  }
  if (becameDone && typeof window.deriveActivityRules === 'function') {
    window.deriveActivityRules();
  }
  deps.save();
  ensureTimerTick();
  deps.renderDashboard();
  if (document.getElementById('phase-year')?.classList.contains('active')) {
    deps.renderYear();
  }
}
export function startTaskTimer(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || t.done) return;
  if (!t.timerStartedAt) t.timerStartedAt = Date.now();
  deps.save();
  ensureTimerTick();
  deps.renderDashboard();
}
export function pauseTaskTimer(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t || !t.timerStartedAt) return;
  t.trackedMs = taskElapsedMs(t);
  t.timerStartedAt = null;
  deps.save();
  ensureTimerTick();
  deps.renderDashboard();
}
export function stopTaskTimer(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.timerStartedAt) t.trackedMs = taskElapsedMs(t);
  t.timerStartedAt = null;
  deps.save();
  ensureTimerTick();
  deps.renderDashboard();
}
export function chipControlsHTML(t) {
  const running = !!t.timerStartedAt;
  const elapsed = formatTracked(taskElapsedMs(t));
  return `<div class="chip-actions" onpointerdown="event.stopPropagation()" onclick="event.stopPropagation()">
    ${ running ? '<span class="chip-timer-dot" title="Timer running"></span>' : '' }
    <span class="chip-timer-time ${ running ? 'running' : '' }" data-timer-display="${ t.id }">${ elapsed }</span>
    ${running
      ? `<button type="button" class="chip-timer-btn active" onclick="pauseTaskTimer('${ t.id }')">Pause</button>
         <button type="button" class="chip-timer-btn" onclick="stopTaskTimer('${ t.id }')">Stop</button>`
      : `<button type="button" class="chip-timer-btn" onclick="startTaskTimer('${ t.id }')" ${ t.done ? 'disabled' : '' }>Start</button>`
    }
  </div>`;
}
export function parseHHMM(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
export function formatHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return pad2(h) + ':' + pad2(m);
}
export function snapCalMins(mins) { return Math.round(mins / CAL_SNAP) * CAL_SNAP; }
export function clampCalStart(startMins, duration) {
  const maxStart = CAL_DAY_END - Math.max(duration || CAL_MIN_DURATION, CAL_MIN_DURATION);
  return Math.max(CAL_DAY_START, Math.min(maxStart, startMins));
}
export function todayYmd() { return formatYmd(new Date()); }
export function ensureDashCalDate() {
  if (!state.dashCalDate) state.dashCalDate = todayYmd();
  return state.dashCalDate;
}

