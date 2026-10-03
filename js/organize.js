import { state, esc, chipControlsHTML, uid } from './state.js';
import { deps } from './deps.js';

export function renderOrganize() {
  const el = document.getElementById('organized-list');
  if (!el) return;
  const sorted = [...state.tasks].sort((a, b) => {
    const sp = { complex: 0, mid: 1, simple: 2 };
    const bs = t => t.blocking ? 0 : 1;
    return bs(a) - bs(b) || (sp[a.size] ?? 3) - (sp[b.size] ?? 3);
  });
  if (!sorted.length) { el.innerHTML = '<div class="empty-state">No tasks yet.</div>'; return; }
  el.innerHTML = sorted.map((t, i) => {
    const sizeColor = t.size === 'complex' ? 'color:#E24B4A' : t.size === 'mid' ? 'color:#EF9F27' : t.size === 'simple' ? 'color:#1D9E75' : '';
    const stHTML = t.subtasks && t.subtasks.filter(s => s.text).length ? `<div class="subtask-list">${t.subtasks.filter(s => s.text).map(s => `<div class="subtask-row"><div class="subtask-dot"></div><span class="subtask-text">${ esc(s.text) }</span></div>`).join('')}</div>` : '';
    return `<div class="org-item" draggable="true" data-id="${ t.id }" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="drop(event)">
      <input type="checkbox" class="select-checkbox group-cb" data-id="${ t.id }" onchange="updateSelCount()" />
      <span class="org-num">${ String(i + 1).padStart(2, '0') }</span>
      <div class="org-body">
        <div class="org-name">${ esc(t.name) }</div>
        <div class="org-meta">
          ${t.who ? `<span class="meta-tag">${ esc(t.who) }</span>` : ''}
          ${ t.blocking ? `<span class="meta-tag meta-blocking">blocking</span>` : '' }
          ${t.size ? `<span class="meta-tag" style="${ sizeColor }">${ t.size }</span>` : ''}
          ${ t.lt === true ? `<span class="meta-tag">long-term</span>` : '' }
        </div>
        ${t.group ? `<span class="group-badge">${ esc(t.group) }</span>` : ''}
        ${ stHTML }
      </div>
    </div>`;
  }).join('');
}

export function dragStart(e) { state.dragSrc = e.currentTarget; e.dataTransfer.effectAllowed = 'move'; }
export function dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }
export function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
export function drop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const target = e.currentTarget;
  if (!state.dragSrc || state.dragSrc === target) return;
  const srcId = state.dragSrc.dataset.id;
  const tgtId = target.dataset.id;
  const srcTask = state.tasks.find(t => t.id === srcId);
  const tgtTask = state.tasks.find(t => t.id === tgtId);
  if (!srcTask || !tgtTask) return;
  const srcIdx = state.tasks.indexOf(srcTask);
  const tgtIdx = state.tasks.indexOf(tgtTask);
  state.tasks.splice(srcIdx, 1);
  state.tasks.splice(tgtIdx, 0, srcTask);
  deps.save(); deps.renderOrganize(); deps.renderSchedule();
}

export function buildScheduleItems() {
  const items = [];
  state.tasks.forEach(t => {
    items.push({ type: 'task', task: t });
    state.schedule.filter(b => b.afterId === t.id).forEach(b => items.push({ type: 'buffer', ...b }));
  });
  return items;
}

export function insertBuffer(afterIdx, icon, label) {
  const combined = buildScheduleItems();
  const item = combined[afterIdx];
  if (!item || item.type !== 'task') return;
  state.schedule.push({ id: uid(), afterId: item.task.id, icon, label });
  deps.save(); deps.renderSchedule();
}

export function removeBuffer(idx) {
  const combined = buildScheduleItems();
  const item = combined[idx];
  if (!item || item.type !== 'buffer') return;
  state.schedule = state.schedule.filter(b => b.id !== item.id);
  deps.save(); deps.renderSchedule();
}

