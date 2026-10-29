/** Assistant work in the app: agent tasks in Delegated, the Errands panel, and runner results. */
import { state, esc, uid, newTask, toggleTaskDone } from './state.js';
import { ghReadJson, ghConnected } from './sync.js';
import { deps } from './deps.js';
import { describeRepeat } from './recurring.js';
import {
  WORKERS, RESULTS_PATH, normalizeErrand, runsFor, taskAgentStatus, errandDueToday, errandRunKey, localYmd,
} from './agent-core.js';
import { act, actOn } from './actions.js';

const LS_RESULTS = 'tb-agent-results';
const REFRESH_MS = 2 * 60000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** A JS string literal for an inline handler, escaped for the attribute it sits in. */
const q = v => esc(JSON.stringify(String(v)));
const workerLabel = id => (WORKERS.find(w => w.id === id) || WORKERS[0]).label;

/* ---------- results from the desktop runner ---------- */

export function loadCachedAgentResults() {
  try { state.agentResults = JSON.parse(localStorage.getItem(LS_RESULTS) || 'null'); } catch (e) { state.agentResults = null; }
}

let lastFetch = 0;
let inFlight = null;
/** Fetch agent/results.json (the runner's file). Quietly keeps the cached copy on failure. */
export function refreshAgentResults(force) {
  if (!ghConnected()) return Promise.resolve(state.agentResults);
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastFetch < REFRESH_MS / 2) return Promise.resolve(state.agentResults);
  inFlight = ghReadJson(RESULTS_PATH).then(j => {
    lastFetch = Date.now();
    state.agentResults = j || { version: 1, runs: [] };
    try { localStorage.setItem(LS_RESULTS, JSON.stringify(state.agentResults)); } catch (e) {}
    renderAgentPanels();
    return state.agentResults;
  }).catch(e => {
    console.warn('agent results', e);
    return state.agentResults;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

let tick = null;
export function startAgentResultsTicker() {
  if (tick) return;
  tick = setInterval(() => {
    if (document.getElementById('phase-dashboard')?.classList.contains('active')) refreshAgentResults();
  }, REFRESH_MS);
}

function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!(ms >= 0)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
function when(iso) {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
}

/** One line on whether the desktop runner is alive and able to work. */
export function runnerStatusHTML() {
  if (!ghConnected()) return '<p class="someday-hint">Connect sync to see assistant results (the runner works from the data repo).</p>';
  const r = state.agentResults && state.agentResults.runner;
  if (!r || !r.lastTickAt) return '<p class="someday-hint">No runner has reported yet. Set it up on the desktop: README → Assistant runner.</p>';
  const stale = Date.now() - Date.parse(r.lastTickAt) > 4 * 3600000;
  const waits = Object.entries(r.waiting || {}).map(([w, x]) =>
    `${workerLabel(w)} is unavailable since ${when(x.since)} (${esc(String(x.message || '').slice(0, 120))}); its work waits and retries.`);
  return `<p class="someday-hint agent-runner ${stale ? 'stale' : ''}">Runner on ${esc(r.host || 'desktop')} · last report ${ago(r.lastTickAt)}${stale ? ' — is the desktop on?' : ''}
    <button type="button" class="btn btn-link" ${act('agentRefresh')}>Refresh</button></p>
    ${waits.map(w => `<p class="someday-hint agent-wait">${w}</p>`).join('')}`;
}

const linkTail = m => (m.match(/(&quot;|[.,;:!?])+$/) || [''])[0];
/** Escaped text with bare links made clickable. */
function linkify(html) {
  return html.replace(/(^|[^"=>])(https?:\/\/[^\s<>"')\]]+)/g, (all, pre, m) => {
    // Sentence punctuation and an escaped closing quote after a link are not part of it.
    const tail = linkTail(m);
    const u = m.slice(0, m.length - tail.length);
    return `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>${tail}`;
  });
}
/**
 * The small Markdown subset assistants write: headings, bold, [text](url), bare links.
 * Everything is escaped first, so model output can never add markup of its own.
 */
export function outputHTML(text) {
  const html = esc(text)
    .replace(/^#{1,6} (.+)$/gm, '<strong class="agent-h">$1</strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)<>"]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return linkify(html);
}

function runDetailsHTML(run, open) {
  if (!run) return '';
  const files = (run.files || []).map(f => f.text != null
    ? `<details class="agent-file"><summary>${esc(f.name)}</summary><pre class="agent-output">${outputHTML(f.text)}</pre></details>`
    : `<div class="someday-meta">${esc(f.name)} (${Math.round(f.size / 1024)} KB, on the desktop in ${esc(run.folder || 'the run folder')})</div>`).join('');
  const meta = [workerLabel(run.worker), run.model, when(run.finishedAt)].filter(Boolean).map(esc).join(' · ');
  return `<details class="agent-run" ${open ? 'open' : ''}>
      <summary>${run.status === 'done' ? 'Result' : 'Failed'} · ${meta}</summary>
      ${run.error ? `<p class="agent-error">${esc(run.error)}</p>` : ''}
      ${run.output ? `<pre class="agent-output">${outputHTML(run.output)}</pre>` : ''}
      ${files}
    </details>`;
}

/* ---------- one-time tasks (assignee: ai) ---------- */

export function agentTaskRowHTML(t) {
  const s = taskAgentStatus(t, state.agentResults);
  const label = s.state === 'ready' ? '<span class="tag agent-ready">Result ready</span>'
    : s.state === 'failed' ? '<span class="tag agent-failed">Failed</span>'
    : `<span class="tag">Queued · ${esc(workerLabel(t.agentWorker))}</span>`;
  const meta = [t.date && `due ${esc(t.date)}`, t.agentWithPlan && 'sees the plan', t.note && esc(t.note.slice(0, 80))].filter(Boolean).join(' · ');
  return `<div class="someday-card agent-card">
      <div class="someday-name">${esc(t.name)} ${label}</div>
      ${meta ? `<div class="someday-meta">${meta}</div>` : ''}
      ${s.state === 'queued' && s.run ? `<div class="someday-meta">Running again with your feedback. Last result:</div>${runDetailsHTML(s.run, false)}` : ''}
      ${s.state !== 'queued' ? runDetailsHTML(s.run, s.state === 'ready') : ''}
      ${s.state !== 'queued' ? `<textarea class="agent-feedback" id="agent-fb-${esc(t.id)}" rows="2"
        placeholder="Feedback for another run (optional)">${esc(t.agentFeedback || '')}</textarea>` : ''}
      <div class="someday-actions">
        ${s.state === 'ready' ? `<button type="button" class="btn primary" ${act('agentAccept', t.id)}>Accept → done</button>` : ''}
        ${s.state !== 'queued' ? `<button type="button" class="btn" ${act('agentRerun', t.id)}>Run again</button>` : ''}
        <button type="button" class="btn" ${act('takeBackTask', t.id)}>Take back</button>
      </div>
    </div>`;
}

export function agentReadyCount() {
  return state.tasks.filter(t => t.assignee === 'ai' && !t.done && t.status !== 'someday'
    && taskAgentStatus(t, state.agentResults).state !== 'queued').length;
}

/** Done, with the result kept in the note so it stays with the task after results roll off. */
export function agentAccept(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const s = taskAgentStatus(t, state.agentResults);
  if (s.run && s.run.output) {
    const out = s.run.output.length > 4000 ? s.run.output.slice(0, 4000) + '\n…' : s.run.output;
    t.note = `${t.note ? t.note + '\n\n' : ''}— Assistant result (${localYmd(new Date(s.run.finishedAt))}) —\n${out}`;
  }
  toggleTaskDone(id, true);
}

export function agentRerun(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const fb = document.getElementById(`agent-fb-${id}`);
  t.agentFeedback = fb ? fb.value.trim() : '';
  t.agentRerunAt = new Date().toISOString();
  deps.save();
  deps.renderDashboard();
}

export function agentRefresh() {
  refreshAgentResults(true);
}

/* ---------- errands (recurring) ---------- */

function errandSchedule(e) {
  return `${describeRepeat(e)} at ${e.time}`;
}

function errandEditorHTML(e) {
  const freq = e.repeat.freq;
  return `<div class="someday-card errand-editor">
      <label class="plan-field">Name <input type="text" id="er-name" value="${esc(e.name)}" placeholder="e.g. Sunday prebrief" /></label>
      <label class="plan-field">Brief <textarea id="er-brief" rows="4" placeholder="What to do each time, and what a good result looks like">${esc(e.brief)}</textarea></label>
      <div class="errand-row">
        <label class="plan-field">Repeats
          <select id="er-freq" ${actOn('change', 'errandFormFreq', '$value')}>
            <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Weekly</option>
            <option value="monthly" ${freq === 'monthly' ? 'selected' : ''}>Monthly (same day as the start date)</option>
          </select>
        </label>
        <label class="plan-field">Every (${freq === 'monthly' ? 'months' : 'weeks'})
          <input type="number" id="er-interval" min="1" max="52" value="${e.repeat.interval}" />
        </label>
        <label class="plan-field">Time <input type="time" id="er-time" value="${esc(e.time)}" /></label>
        <label class="plan-field">Start <input type="date" id="er-from" value="${esc(e.repeat.from || localYmd(new Date()))}" /></label>
      </div>
      <div class="errand-days" id="er-days" ${freq === 'weekly' ? '' : 'hidden'}>
        ${WEEKDAYS.map((d, i) => `<label class="errand-day"><input type="checkbox" value="${i}" ${e.weekdays.includes(i) ? 'checked' : ''} />${d}</label>`).join('')}
      </div>
      <div class="errand-days">
        <span class="someday-meta">Runs on</span>
        ${WORKERS.map(w => `<label class="errand-day" title="${esc(w.hint)}"><input type="radio" name="er-worker" value="${w.id}" ${e.worker === w.id ? 'checked' : ''} />${esc(w.label)} <span class="someday-meta">(${esc(w.hint)})</span></label>`).join('')}
        <label class="errand-day"><input type="checkbox" id="er-plan" ${e.withPlan ? 'checked' : ''} />Share my open plan with it</label>
      </div>
      <div class="someday-actions">
        <button type="button" class="btn primary" ${act('errandSave')}>Save</button>
        <button type="button" class="btn" ${act('errandCancel')}>Cancel</button>
        ${state.errands.some(x => x.id === e.id) ? `<button type="button" class="btn" ${act('errandDelete', e.id)}>Delete</button>` : ''}
      </div>
    </div>`;
}

function errandRowHTML(e) {
  const runs = runsFor(state.agentResults, 'errand', e.id);
  const last = runs[0];
  const fresh = last && (!e.seenAt || last.finishedAt > e.seenAt);
  const pending = e.runNowAt && !runs.some(r => r.key.endsWith(`:now:${e.runNowAt}`));
  const dueNow = errandDueToday(e) && !runs.some(r => r.key === errandRunKey(e, localYmd(new Date())));
  const status = !e.enabled ? '<span class="tag">Paused</span>'
    : pending || dueNow ? '<span class="tag">Queued</span>'
    : fresh ? `<span class="tag ${last.status === 'done' ? 'agent-ready' : 'agent-failed'}">${last.status === 'done' ? 'New result' : 'Failed'}</span>` : '';
  return `<div class="someday-card agent-card">
      <div class="someday-name">${esc(e.name)} ${status}</div>
      <div class="someday-meta">${esc(errandSchedule(e))} · ${esc(workerLabel(e.worker))}${e.withPlan ? ' · sees the plan' : ''}${last ? ` · last run ${ago(last.finishedAt)}` : ''}</div>
      ${last ? runDetailsHTML(last, fresh) : ''}
      ${runs.length > 1 ? `<details class="agent-run"><summary>Earlier runs (${runs.length - 1})</summary>${runs.slice(1).map(r => runDetailsHTML(r, false)).join('')}</details>` : ''}
      <div class="someday-actions">
        ${fresh ? `<button type="button" class="btn primary" ${act('errandSeen', e.id)}>Seen</button>` : ''}
        ${last && last.output ? `<button type="button" class="btn" ${act('errandToTask', last.id)}>Make a task from it</button>` : ''}
        <button type="button" class="btn" ${act('errandRunNow', e.id)} ${pending ? 'disabled' : ''}>Run now</button>
        <button type="button" class="btn" ${act('errandToggle', e.id)}>${e.enabled ? 'Pause' : 'Resume'}</button>
        <button type="button" class="btn" ${act('errandEdit', e.id)}>Edit</button>
      </div>
    </div>`;
}

export function errandNewCount() {
  return state.errands.filter(e => {
    const last = runsFor(state.agentResults, 'errand', e.id)[0];
    return last && (!e.seenAt || last.finishedAt > e.seenAt);
  }).length;
}

export function renderErrandsPanel() {
  const el = document.getElementById('errands-panel');
  if (!el) return;
  const sum = document.getElementById('errands-summary');
  const fresh = errandNewCount();
  if (sum) sum.textContent = `Errands${state.errands.length ? ` (${state.errands.length}${fresh ? ` · ${fresh} new` : ''})` : ''}`;
  const editing = state.errandEditId === 'new'
    ? normalizeErrand({ id: 'new', name: '', repeat: { freq: 'weekly', from: localYmd(new Date()) }, weekdays: [6], time: '08:00' })
    : state.errands.find(e => e.id === state.errandEditId);
  el.innerHTML = `${runnerStatusHTML()}
    <p class="someday-hint">Errands repeat: the assistant runs the brief at the time you set and the result shows up here.</p>
    ${state.errands.map(e => (editing && editing.id === e.id ? errandEditorHTML(e) : errandRowHTML(e))).join('')}
    ${editing && editing.id === 'new' ? errandEditorHTML(editing) : `<button type="button" class="btn" ${act('errandNew')}>+ Errand</button>`}`;
}

export function renderAgentPanels() {
  try { deps.renderDashboard(); } catch (e) { console.warn('render after agent results', e); }
}

function showEditor() {
  renderErrandsPanel();
  const ed = document.querySelector('#errands-panel .errand-editor');
  if (ed) { ed.scrollIntoView({ block: 'nearest' }); const n = document.getElementById('er-name'); if (n) n.focus({ preventScroll: true }); }
}
export function errandNew() { state.errandEditId = 'new'; showEditor(); }
export function errandEdit(id) { state.errandEditId = id; showEditor(); }
export function errandCancel() { state.errandEditId = null; renderErrandsPanel(); }

export function errandFormFreq(freq) {
  const days = document.getElementById('er-days');
  if (days) days.hidden = freq !== 'weekly';
}

export function errandSave() {
  const val = id => (document.getElementById(id) || {}).value || '';
  const name = val('er-name').trim();
  if (!name) { const n = document.getElementById('er-name'); if (n) { n.focus(); n.placeholder = 'Name required…'; } return; }
  const weekdays = [...document.querySelectorAll('#er-days input:checked')].map(i => Number(i.value));
  const worker = (document.querySelector('input[name="er-worker"]:checked') || {}).value;
  const fields = {
    name, brief: val('er-brief'), time: val('er-time'), worker,
    withPlan: !!(document.getElementById('er-plan') || {}).checked,
    repeat: { freq: val('er-freq'), interval: Number(val('er-interval')) || 1, from: val('er-from') },
    weekdays: weekdays.length ? weekdays : [6],
  };
  const existing = state.errands.find(e => e.id === state.errandEditId);
  if (existing) Object.assign(existing, normalizeErrand({ ...existing, ...fields }));
  else state.errands.push(normalizeErrand({ id: uid(), enabled: true, ...fields }));
  state.errandEditId = null;
  deps.save();
  renderErrandsPanel();
}

export function errandDelete(id) {
  const e = state.errands.find(x => x.id === id);
  if (!e || !confirm(`Delete the errand "${e.name}"? Its past results stay in the data repo.`)) return;
  state.errands = state.errands.filter(x => x.id !== id);
  state.errandEditId = null;
  deps.save();
  renderErrandsPanel();
}

function patchErrand(id, fn) {
  const e = state.errands.find(x => x.id === id);
  if (!e) return;
  fn(e);
  deps.save();
  renderErrandsPanel();
}
export function errandToggle(id) { patchErrand(id, e => { e.enabled = !e.enabled; }); }
export function errandRunNow(id) { patchErrand(id, e => { e.runNowAt = new Date().toISOString(); }); }
export function errandSeen(id) {
  const last = runsFor(state.agentResults, 'errand', id)[0];
  patchErrand(id, e => { e.seenAt = last ? last.finishedAt : new Date().toISOString(); });
}

/** Turn an errand result into an inbox task for me, with the result as its note. */
export function errandToTask(runId) {
  const run = ((state.agentResults && state.agentResults.runs) || []).find(r => r.id === runId);
  if (!run) return;
  const first = String(run.output || '').split('\n').find(l => l.trim()) || run.name;
  state.tasks.push(newTask(first.replace(/^[#*\s-]+/, '').slice(0, 120) || run.name, { note: run.output.slice(0, 4000) }));
  deps.save();
  deps.renderDashboard();
}
