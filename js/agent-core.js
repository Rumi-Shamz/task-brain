/**
 * Assistant work: one-time tasks (assignee 'ai') and errands (recurring briefs).
 * Pure logic — no DOM, no state — shared by the app and the desktop runner (scripts/agent_runner.mjs).
 *
 * Who writes what in the private data repo:
 *   data.json            the app only: tasks, errands, and the owner's decisions (accept, run again, seen)
 *   agent/results.json   the runner only: runs and the runner heartbeat
 * One writer per file, so the two never clash.
 */
import { normalizeRepeat, repeatsOn } from './recurring.js';

export const WORKERS = [
  { id: 'claude', label: 'Claude', hint: 'your Claude plan, on the desktop' },
  { id: 'ollama', label: 'Local', hint: 'Ollama on the desktop, nothing leaves it' },
];
export const RESULTS_PATH = 'agent/results.json';
/** Results older than this are kept out of the file so it stays small. */
export const MAX_RUNS_KEPT = 120;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const workerId = w => (WORKERS.some(x => x.id === w) ? w : 'claude');
const isoOrNull = v => (v && !Number.isNaN(Date.parse(v)) ? String(v) : null);

export function normalizeErrand(e) {
  const src = e && typeof e === 'object' ? e : {};
  const repeat = normalizeRepeat(src.repeat);
  if (repeat.freq === 'yearly' || repeat.freq === 'once') repeat.freq = 'weekly';
  const weekdays = Array.isArray(src.weekdays)
    ? [...new Set(src.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
    : [0, 1, 2, 3, 4, 5, 6];
  return {
    ...src,
    id: String(src.id || ''),
    name: String(src.name || '').trim(),
    brief: String(src.brief || ''),
    repeat,
    weekdays,
    time: HHMM_RE.test(String(src.time)) ? String(src.time) : '08:00',
    worker: workerId(src.worker),
    withPlan: !!src.withPlan,
    enabled: src.enabled !== false,
    runNowAt: isoOrNull(src.runNowAt),
    seenAt: isoOrNull(src.seenAt),
  };
}
export function normalizeErrands(list) {
  return (Array.isArray(list) ? list : []).map(normalizeErrand).filter(e => e.id && e.name);
}

/** Task fields for assistant work. Absent = Claude, no plan shared, never re-run. */
export function normalizeAgentFields(t) {
  return {
    agentWorker: workerId(t.agentWorker),
    agentWithPlan: !!t.agentWithPlan,
    agentRerunAt: isoOrNull(t.agentRerunAt),
    agentFeedback: t.agentFeedback != null ? String(t.agentFeedback) : '',
  };
}

export function isAgentTask(t) {
  return !!t && t.assignee === 'ai' && !t.done && t.status !== 'someday' && !!String(t.name || '').trim();
}

/** A run is identified by what asked for it, so the same request never runs twice. */
export function taskRunKey(t) { return `task:${t.id}:${t.agentRerunAt || 'first'}`; }
export function errandRunKey(e, ymd) { return `errand:${e.id}:${ymd}`; }
export function errandNowKey(e) { return `errand:${e.id}:now:${e.runNowAt}`; }

export function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localMinutes(d) { return d.getHours() * 60 + d.getMinutes(); }
function hhmmMinutes(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

/** Is today's occurrence of the errand due (its day, and its time has passed)? */
export function errandDueToday(e, now = new Date()) {
  if (!e.enabled) return false;
  if (!repeatsOn(e, localYmd(now))) return false;
  return localMinutes(now) >= hhmmMinutes(e.time);
}

/**
 * What the runner should do now. Missed days are not caught up: an errand that was due while the
 * desktop was off runs at its next occurrence. Failed runs wait for "Run again".
 * @returns {{ kind: 'task'|'errand', key: string, ref: object, occurrence?: string }[]}
 */
export function dueWork(payload, results, now = new Date()) {
  const seen = new Set(((results && results.runs) || []).map(r => r.key));
  const out = [];
  (payload.tasks || []).forEach(raw => {
    const t = { ...raw, ...normalizeAgentFields(raw) };
    if (!isAgentTask(t)) return;
    const key = taskRunKey(t);
    if (!seen.has(key)) out.push({ kind: 'task', key, ref: t });
  });
  normalizeErrands(payload.errands).forEach(e => {
    if (e.runNowAt) {
      const key = errandNowKey(e);
      if (!seen.has(key)) { out.push({ kind: 'errand', key, ref: e, occurrence: localYmd(now) }); return; }
    }
    if (!errandDueToday(e, now)) return;
    const ymd = localYmd(now);
    const key = errandRunKey(e, ymd);
    if (!seen.has(key)) out.push({ kind: 'errand', key, ref: e, occurrence: ymd });
  });
  return out;
}

export function runsFor(results, kind, refId) {
  return ((results && results.runs) || [])
    .filter(r => r.kind === kind && r.refId === refId)
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

/** Where a task stands for the Delegated panel. */
export function taskAgentStatus(t, results) {
  const runs = runsFor(results, 'task', t.id);
  const current = runs.find(r => r.key === taskRunKey(t));
  if (current) return { state: current.status === 'done' ? 'ready' : 'failed', run: current, previous: runs };
  return { state: 'queued', run: runs[0] || null, previous: runs };
}

/** The open plan, trimmed to what an assistant needs (never notes of other people's tasks in full). */
export function planSnapshot(payload, now = new Date()) {
  const today = localYmd(now);
  const tasks = (payload.tasks || [])
    .filter(t => !t.done && t.status !== 'someday' && String(t.name || '').trim())
    .map(t => ({
      name: t.name, domain: t.domain || null, project: t.projectId || null, activity: t.activity || null,
      date: t.date || null, start: t.start || null, minutes: t.duration || null, lno: t.lno || null,
      who: t.assignee === 'person' ? `→ ${t.delegateTo || 'someone'}` : t.assignee === 'ai' ? 'assistant' : 'me',
      note: t.note ? String(t.note).slice(0, 300) : '',
    }));
  const someday = (payload.tasks || []).filter(t => t.status === 'someday').map(t => t.name).slice(0, 50);
  return { today, openTasks: tasks, someday };
}

export const AGENT_RULES = `You are the assistant in task-brain, the owner's personal planner. You run unattended on the owner's desktop.
- You cannot ask questions. Make reasonable assumptions and list them.
- You cannot send messages, buy, book, sign up, post, or change anything outside your working folder. If the work needs one of those, prepare it (a ready-to-send draft, the exact steps, the links) and list it under "## Needs your approval". Leave that section out when there is nothing for the owner to do.
- Reply in Markdown. First line: a one-sentence summary of the outcome. Then the result itself. Keep it as short as the work allows.
- Put long deliverables in files in the working folder as well, and name them in the reply.
- Cite sources with links when you used the web.`;

/** The user turn for one piece of work. */
export function buildPrompt(item, { plan = null, previous = null, now = new Date() } = {}) {
  const r = item.ref;
  const lines = [`Today is ${localYmd(now)}.`];
  if (item.kind === 'task') {
    lines.push('', `One-time task: ${r.name}`);
    if (r.note) lines.push('', 'Brief:', r.note);
    const meta = [r.domain && `domain ${r.domain}`, r.projectId && `project ${r.projectId}`, r.date && `due ${r.date}`].filter(Boolean);
    if (meta.length) lines.push('', `Context: ${meta.join(', ')}.`);
    if (previous && previous.output) {
      lines.push('', 'Your previous attempt:', '<<<', previous.output.slice(0, 8000), '>>>');
    }
    if (r.agentFeedback) lines.push('', 'Owner feedback for this attempt:', r.agentFeedback);
  } else {
    lines.push('', `Errand (repeats; this is the ${item.occurrence} run): ${r.name}`);
    if (r.brief) lines.push('', 'Brief:', r.brief);
    if (previous && previous.output) {
      lines.push('', 'Last run, for continuity (do not repeat it, report what is new):', '<<<', previous.output.slice(0, 4000), '>>>');
    }
  }
  if (plan) lines.push('', "The owner's current plan (JSON):", JSON.stringify(plan));
  return lines.join('\n');
}

/**
 * Results file the runner keeps: newest first. Old runs are dropped past MAX_RUNS_KEPT, but the
 * newest few of each task and errand always stay, so a dropped run can never make work run twice.
 */
export function addRun(results, run, perRef = 3) {
  const base = results && typeof results === 'object' ? results : {};
  const all = [run, ...((base.runs || []).filter(r => r.key !== run.key))]
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  const perRefCount = new Map();
  const runs = all.filter((r, i) => {
    const ref = `${r.kind}:${r.refId}`;
    const n = (perRefCount.get(ref) || 0) + 1;
    perRefCount.set(ref, n);
    return n <= perRef || i < MAX_RUNS_KEPT;
  });
  return { ...base, version: 1, runs };
}
