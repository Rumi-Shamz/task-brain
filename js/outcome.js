/**
 * Outcomes and unlocks. A task can wait on other tasks (`blockedBy`); while one of them is open it is
 * locked: tagged on the board and left out of next up. Finishing a bigger task asks for its outcome
 * (result + note) and offers follow-ups, which wait on it, so the chain of a project stays readable.
 * Small tasks (size Simple, no project, nothing waiting on them) are checked off without a prompt.
 */
import { state, esc, newTask } from './state.js';
import { deps } from './deps.js';

export const RESULTS = [
  { id: 'planned', label: 'Done as planned' },
  { id: 'partial', label: 'Partly' },
  { id: 'failed', label: "Didn't work" },
];

const byId = id => state.tasks.find(x => x.id === id);

/** Open tasks this one waits on (missing or finished ones no longer hold it). */
export function blockersOf(t) {
  return (t && Array.isArray(t.blockedBy) ? t.blockedBy : []).map(byId).filter(b => b && !b.done);
}
export function isLocked(t) {
  return blockersOf(t).length > 0;
}
/** Tasks that wait on `id`. */
export function dependentsOf(id) {
  return state.tasks.filter(t => Array.isArray(t.blockedBy) && t.blockedBy.includes(id));
}

/** Whether checking `t` off should ask for its outcome. */
export function needsOutcome(t) {
  if (!t || t.parentId) return false;
  if (dependentsOf(t.id).length) return true;
  if (t.size === 'mid' || t.size === 'complex') return true;
  return !!(t.projectId || t.project) && t.size !== 'simple';
}

export function lockTagHTML(t) {
  const b = blockersOf(t);
  if (!b.length) return '';
  return `<span class="tag tag-locked" title="Waits on: ${esc(b.map(x => x.name).join(', '))}">🔒 waits on ${esc(b[0].name)}${b.length > 1 ? ` +${b.length - 1}` : ''}</span>`;
}

/** Candidates for "waits on": open top-level tasks, same project first, then same domain. */
export function blockerCandidates(t) {
  const rank = x => (x.projectId && x.projectId === t.projectId ? 0 : x.domain === t.domain ? 1 : 2);
  // Never offer a task that (through its own chain) already waits on t: that would lock both forever.
  const waitsOnT = new Set();
  const walk = id => dependentsOf(id).forEach(d => { if (!waitsOnT.has(d.id)) { waitsOnT.add(d.id); walk(d.id); } });
  walk(t.id);
  return state.tasks
    .filter(x => x.id !== t.id && !x.done && x.status !== 'someday' && !x.parentId && !waitsOnT.has(x.id))
    .sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}

/** Save the outcome and create follow-ups (they wait on the task, so the link is kept). */
export function recordOutcome(id, { result = null, note = '', followUps = [] } = {}) {
  const t = byId(id);
  if (!t) return [];
  const cleanNote = String(note || '').trim();
  if (result || cleanNote) t.outcome = { result: RESULTS.some(r => r.id === result) ? result : null, note: cleanNote };
  return followUps.map(n => String(n || '').trim()).filter(Boolean).map(name => {
    const f = newTask(name, {
      domain: t.domain, project: t.project || null, projectId: t.projectId || null,
      activity: 'act', lane: 'act', status: 'todo', blockedBy: [t.id],
    });
    state.tasks.push(f);
    return f;
  });
}

// ---------- the sheet ----------

let draft = null;

export function openOutcome(id) {
  const t = byId(id);
  if (!t) return;
  draft = { id, result: (t.outcome && t.outcome.result) || null };
  renderOutcomeSheet();
}

export function setOutcomeResult(r) {
  if (draft) draft.result = r;
  document.querySelectorAll('#outcome-sheet [data-result]').forEach(b => b.classList.toggle('primary', b.dataset.result === r));
}

export function addOutcomeFollowUp() {
  const list = document.getElementById('oc-followups');
  if (!list) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'oc-followup';
  input.placeholder = 'Next step this opens up';
  list.appendChild(input);
  input.focus();
}

export function closeOutcome() {
  draft = null;
  document.getElementById('outcome-sheet')?.remove();
}

export function saveOutcome() {
  if (!draft) return;
  const note = document.getElementById('oc-note')?.value || '';
  const followUps = [...document.querySelectorAll('#outcome-sheet .oc-followup')].map(i => i.value);
  recordOutcome(draft.id, { result: draft.result, note, followUps });
  closeOutcome();
  deps.save();
  deps.renderDashboard();
}

function renderOutcomeSheet() {
  const t = draft && byId(draft.id);
  if (!t) return;
  let el = document.getElementById('outcome-sheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'outcome-sheet';
    el.className = 'dash-edit-sheet';
    document.body.appendChild(el);
  }
  const unlocked = dependentsOf(t.id).filter(d => !d.done);
  el.innerHTML = `
    <div class="dash-edit-backdrop" onclick="closeOutcome()"></div>
    <div class="dash-edit-panel" role="dialog" aria-label="Outcome">
      <div class="dash-edit-head">
        <strong>Done · ${esc(t.name)}</strong>
        <button type="button" class="btn" onclick="closeOutcome()">Skip</button>
      </div>
      <div class="plan-field">Result
        <div class="oc-results">${RESULTS.map(r =>
          `<button type="button" class="btn ${draft.result === r.id ? 'primary' : ''}" data-result="${r.id}" onclick="setOutcomeResult('${r.id}')">${esc(r.label)}</button>`).join('')}
        </div>
      </div>
      <label class="plan-field">Outcome
        <textarea id="oc-note" rows="3" placeholder="What came out of it?">${esc((t.outcome && t.outcome.note) || '')}</textarea>
      </label>
      ${unlocked.length ? `<div class="plan-field">Unlocked now
        <ul class="oc-unlocked">${unlocked.map(d => `<li>${esc(d.name)}</li>`).join('')}</ul>
      </div>` : ''}
      <div class="plan-field">Follow-ups
        <div id="oc-followups"><input type="text" class="oc-followup" placeholder="Next step this opens up" /></div>
        <button type="button" class="btn" onclick="addOutcomeFollowUp()">+ another</button>
      </div>
      <div class="plan-step-actions">
        <button type="button" class="btn primary" onclick="saveOutcome()">Save</button>
        <button type="button" class="btn" onclick="closeOutcome()">Skip</button>
      </div>
    </div>`;
}
