/** Plan card: subtasks (Enter adds the next) and the draining / recovery-buffer picker. */
import { state, esc, uid, BUFFERS } from './state.js';
import { deps } from './deps.js';
import { currentPlanTask, renderPlanWizard } from './plan.js';

let focusSubtaskId = null;

/** The subtask input to focus after the next render (read once). */
export function takeFocusSubtaskId() {
  const id = focusSubtaskId;
  focusSubtaskId = null;
  return id;
}

export function ensureSubtasks(t) {
  if (!Array.isArray(t.subtasks)) t.subtasks = [];
  if (t.size !== 'mid' && t.size !== 'complex') return;
  // Always keep one trailing empty input for quick Enter-to-next entry
  const last = t.subtasks[t.subtasks.length - 1];
  if (!last || String(last.text || '').trim()) {
    if (t.subtasks.length < 9) t.subtasks.push({ id: uid(), text: '' });
  }
}

export function subtasksHTML(t) {
  if (t.size !== 'mid' && t.size !== 'complex') return '';
  ensureSubtasks(t);
  return `<div class="plan-subtasks">
    <span class="plan-subtasks-label">Subtasks</span>
    <div class="subtask-list">
      ${t.subtasks.map((s, i) => `
        <div class="subtask-row">
          <div class="subtask-dot"></div>
          <input class="subtask-input" data-sid="${s.id}" value="${esc(s.text)}" placeholder="subtask…"
            oninput="planUpdateSubtask('${t.id}','${s.id}',this.value)"
            onkeydown="planSubtaskKey(event,'${t.id}','${s.id}')" />
          ${String(s.text || '').trim() || i < t.subtasks.length - 1
            ? `<span class="task-del" onclick="planRemoveSubtask('${t.id}','${s.id}')">✕</span>`
            : '<span class="task-del" style="visibility:hidden">✕</span>'}
        </div>`).join('')}
    </div>
  </div>`;
}

function buffersForTask(taskId) {
  return (state.schedule || []).filter(b => b.afterId === taskId);
}

export function drainingHTML(t) {
  const bufs = buffersForTask(t.id);
  return `<div class="plan-field">Energy
    <div class="plan-choices" style="margin-bottom:6px;">
      <button type="button" class="btn ${t.draining ? 'primary' : ''}" onclick="planToggleDraining()">
        ${t.draining ? 'Draining — on' : 'Mark as draining'}
      </button>
    </div>
    ${t.draining ? `
      <span class="triage-label" style="display:block;margin-bottom:5px;">Add recovery after this</span>
      <div class="buffer-picker">
        ${BUFFERS.filter(b => b.energy !== 'down').map(b =>
          `<button type="button" class="bpick" onclick="planAddBuffer('${esc(b.icon)}','${esc(b.label)}')">${b.icon} ${esc(b.label)}</button>`
        ).join('')}
      </div>
      ${bufs.length ? `<ul class="plan-batch-list">${bufs.map(b =>
        `<li>${b.icon} ${esc(b.label)}
          <button type="button" class="btn" onclick="planRemoveBuffer('${b.id}')">Remove</button></li>`
      ).join('')}</ul>` : ''}
    ` : ''}
  </div>`;
}

export function planToggleDraining() {
  const t = currentPlanTask();
  if (!t) return;
  t.draining = !t.draining;
  deps.save();
  renderPlanWizard();
}

export function planAddBuffer(icon, label) {
  const t = currentPlanTask();
  if (!t) return;
  if (!Array.isArray(state.schedule)) state.schedule = [];
  state.schedule.push({ id: uid(), afterId: t.id, icon, label });
  deps.save();
  renderPlanWizard();
}

export function planRemoveBuffer(bufId) {
  state.schedule = (state.schedule || []).filter(b => b.id !== bufId);
  deps.save();
  renderPlanWizard();
}

export function planAddSubtask(taskId) {
  const t = state.tasks.find(x => x.id === taskId) || currentPlanTask();
  if (!t || (t.subtasks || []).length >= 9) return;
  if (!t.subtasks) t.subtasks = [];
  const next = { id: uid(), text: '' };
  t.subtasks.push(next);
  focusSubtaskId = next.id;
  deps.save();
  renderPlanWizard();
}

export function planSubtaskKey(e, tid, sid) {
  if (!e || e.key !== 'Enter') return;
  e.preventDefault();
  const t = state.tasks.find(x => x.id === tid);
  if (!t) return;
  const s = (t.subtasks || []).find(x => x.id === sid);
  if (s) s.text = e.target?.value ?? s.text;
  const text = String(s?.text || '').trim();
  if (!text) return;
  ensureSubtasks(t);
  const idx = t.subtasks.findIndex(x => x.id === sid);
  const next = t.subtasks[idx + 1] || t.subtasks[t.subtasks.length - 1];
  focusSubtaskId = next?.id || null;
  deps.save();
  renderPlanWizard();
}

export function planUpdateSubtask(tid, sid, val) {
  const t = state.tasks.find(x => x.id === tid);
  if (!t) return;
  const s = (t.subtasks || []).find(x => x.id === sid);
  if (s) { s.text = val; deps.save(); }
}

export function planRemoveSubtask(tid, sid) {
  const t = state.tasks.find(x => x.id === tid);
  if (!t) return;
  t.subtasks = (t.subtasks || []).filter(s => s.id !== sid);
  ensureSubtasks(t);
  deps.save();
  renderPlanWizard();
}
