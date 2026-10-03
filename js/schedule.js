import { state, BUFFERS, esc } from './state.js';
import { deps } from './deps.js';

export function renderSchedule() {
  const el = document.getElementById('schedule-list');
  const summary = document.getElementById('plan-summary');
  summary.innerHTML = `<h3>Today at a glance</h3>
    <div class="plan-stats">
      <div><div class="plan-stat">${ state.tasks.length }</div><div class="plan-stat-label">state.tasks</div></div>
      <div><div class="plan-stat">${ state.tasks.filter(t => t.blocking).length }</div><div class="plan-stat-label">blocking</div></div>
      <div><div class="plan-stat">${ state.tasks.filter(t => t.size === 'complex').length }</div><div class="plan-stat-label">complex</div></div>
    </div>`;
  const combined = buildScheduleItems();
  if (!combined.length) { el.innerHTML = '<div class="empty-state">No tasks yet — go to phase 01.</div>'; return; }
  el.innerHTML = combined.map((item, i) => {
    if (item.type === 'buffer') {
      return `<div class="buffer-row">
        <span style="font-size:14px;">${ item.icon }</span>
        <span class="buffer-label">${ esc(item.label) }</span>
        <span class="task-del" onclick="removeBuffer(${ i })">✕</span>
      </div>`;
    }
    const t = item.task;
    const stHTML = t.subtasks && t.subtasks.filter(s => s.text).length ? `<div class="subtask-list" style="margin-top:6px;">${t.subtasks.filter(s => s.text).map(s => `<div class="subtask-row"><div class="subtask-dot"></div><span class="subtask-text">${ esc(s.text) }</span></div>`).join('')}</div>` : '';
    const bufferPicker = t.draining ? `<div style="margin-top:8px;"><span class="triage-label" style="display:block;margin-bottom:5px;">Add recovery after this:</span><div class="buffer-picker">${BUFFERS.filter(b => b.energy !== 'down').map(b => `<button class="bpick" onclick="insertBuffer(${ i },'${ b.icon }','${ esc(b.label) }')">${ b.icon } ${ b.label }</button>`).join('')}</div></div>` : '';
    return `<div class="org-item" style="flex-direction:column;gap:4px;">
      <div style="display:flex;gap:10px;align-items:flex-start;width:100%;">
        <span class="org-num">${ String(i + 1).padStart(2, '0') }</span>
        <div class="org-body" style="flex:1;">
          <div class="org-name">${ esc(t.name) }</div>
          <div class="org-meta">
            ${t.who ? `<span class="meta-tag">${ esc(t.who) }</span>` : ''}
            ${ t.blocking ? `<span class="meta-tag meta-blocking">blocking</span>` : '' }
            ${t.size ? `<span class="meta-tag">${ t.size }</span>` : ''}
          </div>
          ${ stHTML }
          <span class="draining-flag ${ t.draining ? 'flagged' : '' }" onclick="toggleDraining('${ t.id }')">${ t.draining ? '⚡ draining — add recovery below' : '+ mark as draining' }</span>
          ${ bufferPicker }
        </div>
      </div>
    </div>`;
  }).join('');
}

