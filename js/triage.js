import {
  state, esc, chipControlsHTML, projectClass, newTask,
} from './state.js';
import { deps } from './deps.js';

// Week-plan import (schema-validated) — see js/import-plan.js + schema/plan.schema.json
export {
  importWeeklyPlanFile,
  importWeeklyPlanRows,
  importWeeklyPlanJson,
  parseCsvText,
  DOMAINS,
} from './import-plan.js';

export function uid() { return Math.random().toString(36).slice(2, 8); }

export function addSingle() {
  const inp = document.getElementById('single-input');
  const val = inp.value.trim();
  if (!val) return;
  state.tasks.push(newTask(val));
  inp.value = '';
  deps.save(); deps.render();
}

export function toggleBulk() {
  const el = document.getElementById('bulk-area');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

export function importBulk() {
  const lines = document.getElementById('bulk-input').value.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(name => state.tasks.push(newTask(name)));
  document.getElementById('bulk-input').value = '';
  toggleBulk();
  deps.save(); deps.render();
}

export function deleteTask(id) { state.tasks = state.tasks.filter(t => t.id !== id); deps.save(); deps.render(); }

export function setSize(id, size) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  t.size = t.size === size ? null : size;
  if (t.size && (t.size === 'complex' || t.size === 'mid') && t.subtasks.length === 0) {
    t.subtasks = [{ id: uid(), text: '' }, { id: uid(), text: '' }];
  }
  deps.save(); deps.render();
}

export function setBlocking(id, val) { const t = state.tasks.find(t => t.id === id); if (t) { t.blocking = val; deps.save(); deps.render(); } }
export function setLT(id, val) {
  // Legacy bridge: yes→L, no→N
  setLNO(id, val === true ? 'L' : val === false ? 'N' : null);
}
export function setLNO(id, val) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  const next = val === 'L' || val === 'N' || val === 'O' ? val : null;
  t.lno = t.lno === next ? null : next;
  t.lt = t.lno === 'L' ? true : t.lno === 'N' ? false : null;
  deps.save(); deps.render();
}
export function updateWho(id, val) { const t = state.tasks.find(t => t.id === id); if (t) { t.who = val; deps.save(); } }
export function addSubtask(id) { const t = state.tasks.find(t => t.id === id); if (t && t.subtasks.length < 9) { t.subtasks.push({ id: uid(), text: '' }); deps.save(); deps.render(); } }
export function updateSubtask(tid, sid, val) { const t = state.tasks.find(t => t.id === tid); if (t) { const s = t.subtasks.find(s => s.id === sid); if (s) { s.text = val; deps.save(); } } }
export function removeSubtask(tid, sid) { const t = state.tasks.find(t => t.id === tid); if (t) { t.subtasks = t.subtasks.filter(s => s.id !== sid); deps.save(); deps.render(); } }
export function toggleDraining(id) { const t = state.tasks.find(t => t.id === id); if (t) { t.draining = !t.draining; deps.save(); deps.renderSchedule(); } }

export function toggleTriageForm(id) {
  const el = document.getElementById('tf-' + id);
  const arrow = document.getElementById('arr-' + id);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▸ triage' : '▴ triage';
}


export function groupSelected() {
  const checked = [...document.querySelectorAll('.group-cb:checked')].map(el => el.dataset.id);
  if (checked.length < 2) return;
  state.groupCounter++;
  const gName = `Group ${state.groupCounter}`;
  state.groups[gName] = checked;
  checked.forEach(id => { const t = state.tasks.find(t => t.id === id); if (t) t.group = gName; });
  deps.save(); deps.renderOrganize();
}

export function clearSelection() { document.querySelectorAll('.group-cb').forEach(cb => cb.checked = false);
  updateSelCount(); }

export function updateSelCount() {
  const n = document.querySelectorAll('.group-cb:checked').length;
  document.getElementById('sel-count').textContent = n > 0 ? `${ n } selected` : '';
}


export const setWho = updateWho;

export function renderTriage() {
  const el = document.getElementById('task-list');
  if (!state.tasks.length) { el.innerHTML = '<div class="empty-state">No tasks yet — add one above.</div>'; return; }
  el.innerHTML = state.tasks.map(t => {
    const sizeClass = t.size ? `triaged ${t.size}` : '';
    const subHTML = (t.size === 'complex' || t.size === 'mid') ? `
      <div class="subtask-list">
        ${t.subtasks.map(s => `
          <div class="subtask-row">
            <div class="subtask-dot"></div>
            <input class="subtask-input" value="${esc(s.text)}" placeholder="subtask..." oninput="updateSubtask('${t.id}','${s.id}',this.value)" />
            <span class="task-del" onclick="removeSubtask('${t.id}','${s.id}')">✕</span>
          </div>`).join('')}
        ${t.subtasks.length < 9 ? `<span class="toggle-triage" onclick="addSubtask('${t.id}')">+ subtask</span>` : ''}
      </div>` : '';
    return `<div class="task-card ${sizeClass}">
      <div class="task-top">
        <span class="task-name">${esc(t.name)}</span>
        <span class="task-del" onclick="deleteTask('${t.id}')">✕</span>
      </div>
      <span class="toggle-triage" id="arr-${t.id}" onclick="toggleTriageForm('${t.id}')">▸ triage</span>
      <div class="triage-form" id="tf-${t.id}" style="display:none;">
        <div class="triage-grid">
          <div class="triage-field">
            <span class="triage-label">Who is affected</span>
            <input type="text" value="${esc(t.who)}" placeholder="person / org" oninput="updateWho('${t.id}',this.value)" />
          </div>
          <div class="triage-field">
            <span class="triage-label">Blocking</span>
            <div class="blocking-toggle">
              <span class="pill ${t.blocking === true ? 'active-yn' : ''}" onclick="setBlocking('${t.id}',true)">Yes</span>
              <span class="pill ${t.blocking === false ? 'active-yn' : ''}" onclick="setBlocking('${t.id}',false)">No</span>
            </div>
          </div>
          <div class="triage-field">
            <span class="triage-label">LNO</span>
            <div class="lno-toggle">
              <span class="pill ${t.lno === 'L' ? 'active-yn' : ''}" title="10x return, give it your best energy" onclick="setLNO('${t.id}','L')">L</span>
              <span class="pill ${t.lno === 'N' ? 'active-yn' : ''}" title="do it well enough" onclick="setLNO('${t.id}','N')">N</span>
              <span class="pill ${t.lno === 'O' ? 'active-yn' : ''}" title="minimize, batch, delegate first" onclick="setLNO('${t.id}','O')">O</span>
            </div>
            <span class="triage-label" style="margin-top:4px;font-weight:400;text-transform:none;letter-spacing:0;">${
              t.lno === 'L' ? '10x return — best energy' : t.lno === 'N' ? 'Do it well enough' : t.lno === 'O' ? 'Minimize / batch / delegate' : 'Pick leverage'
            }</span>
          </div>
          <div class="triage-field">
            <span class="triage-label">Size</span>
            <div class="size-pills">
              <span class="pill ${t.size === 'complex' ? 'active-complex' : ''}" onclick="setSize('${t.id}','complex')">Complex</span>
              <span class="pill ${t.size === 'mid' ? 'active-mid' : ''}" onclick="setSize('${t.id}','mid')">Mid</span>
              <span class="pill ${t.size === 'simple' ? 'active-simple' : ''}" onclick="setSize('${t.id}','simple')">Simple</span>
            </div>
          </div>
        </div>
        ${subHTML}
      </div>
    </div>`;
  }).join('');
}
