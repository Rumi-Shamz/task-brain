/**
 * Recovery after a long task: a short break right after it, matched to the kind of work.
 * Screen focus (research, learn) → a short walk with eyes off the screen; hands-on or draining work
 * → a coffee break away from it; calls and meetings (communicate) → quiet minutes and water.
 * `t.recovery`: null = suggested, 'planned' = you took the suggestion, 'skip' = not for this task.
 */
import { state, parseHHMM, formatHHMM, DEFAULT_DURATION } from './state.js';
import { deps } from './deps.js';

/** Only tasks longer than this get a break suggested. */
export const RECOVERY_AFTER_MIN = 30;

const KINDS = {
  walk: { icon: '🚶', label: 'Short walk, eyes off the screen' },
  coffee: { icon: '☕', label: 'Coffee break, step away' },
  quiet: { icon: '💧', label: 'Quiet minutes and water' },
};

/** Break length: 5 min up to an hour, 10 up to two hours, 15 beyond. */
export function recoveryMinutes(duration) {
  const d = Number(duration) || 0;
  if (d <= RECOVERY_AFTER_MIN) return 0;
  return d <= 60 ? 5 : d <= 120 ? 10 : 15;
}

/** The suggestion for t ({ kind, icon, label, minutes, start, end } in minutes of the day), or null. */
export function recoveryFor(t) {
  if (!t || t.recovery === 'skip') return null;
  const dur = Number(t.duration) || DEFAULT_DURATION;
  const minutes = recoveryMinutes(dur);
  if (!minutes) return null;
  const act = t.activity || t.lane || 'act';
  const kind = t.draining || act === 'act' ? 'coffee' : act === 'communicate' ? 'quiet' : 'walk';
  const startMin = t.start ? parseHHMM(t.start) : null;
  const start = startMin == null ? null : startMin + dur;
  return { kind, ...KINDS[kind], minutes, start, end: start == null ? null : start + minutes, planned: t.recovery === 'planned' };
}

/** Short text for cards and the Organize hint, e.g. "After: 10 min · Short walk, eyes off the screen". */
export function recoveryText(r) {
  return r ? `After: ${r.minutes} min · ${r.label}` : '';
}

/** Today's breaks that do not run into another scheduled task (those would only be noise). */
export function recoveriesOnDate(ymd) {
  const day = state.tasks.filter(t => t.date === ymd && t.start && t.status !== 'someday');
  return day.map(t => ({ t, r: recoveryFor(t) })).filter(({ t, r }) => {
    if (!r || r.start == null || r.end > 24 * 60) return false;
    return !day.some(o => {
      if (o.id === t.id) return false;
      const s = parseHHMM(o.start);
      const e = s + (Number(o.duration) || DEFAULT_DURATION);
      return s < r.end && e > r.start;
    });
  });
}

export function recoveryLabelHTML(r) {
  return `${r.icon} <span class="num">${r.minutes}</span> min · ${r.label} · <span class="num">${formatHHMM(r.start)}–${formatHHMM(r.end)}</span>`;
}

/** Take the suggestion (it stays on the calendar as a solid break), or put it back to a suggestion. */
export function planRecovery(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.recovery = t.recovery === 'planned' ? null : 'planned';
  deps.save();
  deps.renderDayCalendar();
}

export function skipRecovery(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.recovery = 'skip';
  deps.save();
  deps.renderDayCalendar();
}
