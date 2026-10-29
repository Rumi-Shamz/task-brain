/** ISO weeks, the extraction prompt context, and the weekly prebrief — all from data.json. */

const pad2 = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const addDays = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** "2026-02-31" is not a date: JavaScript would roll it into March, so check the round trip. */
export function realDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
}

/** Value after a flag, or an error when it is missing or is the next flag. */
export function flagValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
  return v;
}

export function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

/** "2026-W41" → Monday as a UTC Date */
export function mondayOfIsoWeek(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(label || ''));
  if (!m) throw new Error(`Week must look like 2026-W41, got "${label}"`);
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const week1Mon = addDays(jan4, -((jan4.getUTCDay() || 7) - 1));
  return addDays(week1Mon, (+m[2] - 1) * 7);
}

export function weekDates(label) {
  const mon = mondayOfIsoWeek(label);
  return Array.from({ length: 7 }, (_, i) => ymd(addDays(mon, i)));
}

export function previousWeek(label) {
  return isoWeek(new Date(`${ymd(addDays(mondayOfIsoWeek(label), -7))}T12:00:00`));
}

function projectNames(data) {
  const byId = new Map();
  (data.projects || []).forEach(p => byId.set(p.id, p));
  (data.customProjects || []).forEach(p => { if (!byId.has(p.id)) byId.set(p.id, { id: p.id, name: p.label, domain: p.domain }); });
  return byId;
}

/** Short text the extractor sees so it reuses existing project names and does not duplicate open tasks. */
export function extractionContext(data) {
  if (!data) return '';
  const projects = [...projectNames(data).values()]
    .filter(p => p.status !== 'archived')
    .map(p => `- ${p.name || p.id} (domain ${p.domain || (p.domains || [])[0] || 'Personal'})`);
  const open = (data.tasks || [])
    .filter(t => !t.done && t.status !== 'done' && !t.parentId)
    .slice(0, 150)
    .map(t => `- ${t.name}${t.status === 'someday' ? ' [someday]' : ''}`);
  return [
    projects.length ? `Existing projects (reuse these exact names):\n${projects.join('\n')}` : '',
    open.length ? `Open tasks already in the app (do not repeat them unless the transcript changes them):\n${open.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

const minutesOf = t => Number(t.duration) || 30;

/** Local day of an ISO timestamp, so a task finished at 23:30 counts on that day, not the UTC one. */
function localYmd(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Planned vs done for one ISO week. Done means finished during the week (`doneAt`), or, for tasks
 * finished before doneAt existed, done with a day in the week. Slipped means it rolled away from a day
 * in the week (task.missed) and was not finished by the end of it.
 */
export function weekReview(data, label) {
  const days = weekDates(label);
  const dates = new Set(days);
  const weekEnd = days[6];
  const tasks = (data && data.tasks) || [];
  const isDone = t => t.done || t.status === 'done';
  const doneDay = t => (t.doneAt ? localYmd(t.doneAt) : null);
  const doneInWeek = t => isDone(t) && (doneDay(t) ? dates.has(doneDay(t)) : !!t.date && dates.has(t.date));
  const doneByWeekEnd = t => isDone(t) && (doneDay(t) ? doneDay(t) <= weekEnd : !!t.date && t.date <= weekEnd);
  const planned = tasks.filter(t => (t.date && dates.has(t.date)) || (t.missed || []).some(d => dates.has(d)) || doneInWeek(t));
  const done = planned.filter(doneInWeek);
  const missed = planned.filter(t => (t.missed || []).some(d => dates.has(d)) && !doneByWeekEnd(t));
  // Moved on purpose (Defer) away from a day in the week, and not done in it.
  const deferred = tasks.filter(t => (t.deferred || []).some(d => dates.has(d)) && !doneInWeek(t));
  const projects = projectNames(data || {});
  const byDomain = {};
  let doneMin = 0, lMin = 0;
  done.forEach(t => {
    const m = minutesOf(t);
    doneMin += m;
    if (t.lno === 'L') lMin += m;
    const d = t.domain || 'Personal';
    byDomain[d] = (byDomain[d] || 0) + m;
  });
  return {
    label,
    planned, done, missed, deferred,
    doneMinutes: doneMin,
    lPercent: doneMin ? Math.round((lMin / doneMin) * 100) : 0,
    byDomain,
    projectName: id => (projects.get(id) || {}).name || id,
  };
}

/** "- Name — Domain / Project · 60 min · note…" for the review lists. */
function taskLine(t, projectName, { tracked = false, due = false } = {}) {
  const where = [t.domain || 'Personal', t.projectId || t.project ? projectName(t.projectId || t.project) : null].filter(Boolean).join(' / ');
  const bits = [where];
  if (due && t.date) bits.push(t.date);
  bits.push(`${minutesOf(t)} min`);
  if (tracked && t.trackedMs) bits.push(`tracked ${(t.trackedMs / 3600000).toFixed(1)}h`);
  if (t.assignee === 'person' && t.delegateTo) bits.push(`by ${t.delegateTo}`);
  if (t.assignee === 'ai') bits.push('by the assistant');
  const note = String(t.note || '').replace(/\s+/g, ' ').trim();
  return `- ${t.name} — ${bits.join(' · ')}${note ? ` — ${note.length > 160 ? note.slice(0, 157) + '…' : note}` : ''}`;
}

export function buildPrebrief(data, label) {
  const prev = previousWeek(label);
  const lines = [`# Prebrief ${label}`, ''];
  if (!data) {
    lines.push('_No data.json given — pass --data path/to/data.json for last week._', '');
  } else {
    const r = weekReview(data, prev);
    const rate = r.planned.length ? Math.round((r.done.length / r.planned.length) * 100) : 0;
    lines.push(`## Last week (${prev})`);
    lines.push(`- Done ${r.done.length} of ${r.planned.length} planned (${rate}%)`);
    lines.push(`- Hours done: ${(r.doneMinutes / 60).toFixed(1)} · on L: ${r.lPercent}%`);
    const doms = Object.entries(r.byDomain).sort((a, b) => b[1] - a[1]);
    if (doms.length) {
      lines.push('- By domain:');
      doms.forEach(([d, m]) => lines.push(`  - ${d}: ${(m / 60).toFixed(1)}h`));
    }
    if (r.done.length) {
      lines.push('', '## Done last week');
      r.done
        .slice().sort((a, b) => String(a.doneAt || a.date).localeCompare(String(b.doneAt || b.date)))
        .forEach(t => lines.push(taskLine(t, r.projectName, { tracked: true })));
    }
    if (r.missed.length) {
      lines.push('', '## Slipped (planned, not done)');
      r.missed
        .sort((a, b) => (b.missed || []).length - (a.missed || []).length)
        .forEach(t => lines.push(`- ${t.name}${(t.missed || []).length > 1 ? ` — slipped ${(t.missed || []).length}×` : ''}`));
    }
    if (r.deferred.length) {
      lines.push('', '## Deferred (moved on purpose)');
      r.deferred.forEach(t => lines.push(`- ${t.name} — ${t.status === 'someday' ? 'to the backlog' : `to ${t.date || '?'}`}`));
    }
    const open = (data.tasks || []).filter(t => !t.done && t.status !== 'done' && t.status !== 'someday' && !t.parentId);
    if (open.length) {
      lines.push('', '## Still open');
      open
        .slice().sort((a, b) => String(a.domain || '').localeCompare(String(b.domain || '')) || String(a.date || '9').localeCompare(String(b.date || '9')))
        .forEach(t => lines.push(taskLine(t, r.projectName, { due: true })));
    }
    const weekEnd = weekDates(label)[6];
    const due = (data.tasks || []).filter(t => t.status === 'someday' && (!t.reviewAt || t.reviewAt <= weekEnd));
    if (due.length) {
      lines.push('', '## Someday items due for a decision');
      due.forEach(t => lines.push(`- ${t.name}${t.deleteCandidate ? ' (delete candidate)' : ''}`));
    }
    const learn = (data.skills || []).filter(s => s.quadrant === 'schedule' || s.quadrant === 'now');
    if (learn.length) {
      lines.push('', '## Skills to learn');
      learn.forEach(s => lines.push(`- ${s.name} (${s.quadrant})`));
    }
  }
  lines.push('', '## Questions for the session');
  lines.push('1. Which slipped items still matter? Re-plan, move to someday, or drop.');
  lines.push('2. What L work moves the needle this week, and when is the deep-work block for it?');
  lines.push('3. Who or what can take the O work?');
  lines.push('');
  return lines.join('\n');
}
