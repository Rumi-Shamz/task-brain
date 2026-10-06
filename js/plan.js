/** 01 Plan — single-screen triage + batches + merge projects. */
import {
  state, esc, newTask, isTopLevelTask, childTasksOf,
} from './state.js';
import { domainLabel, normalizeDomainId } from './domains.js';
import {
  getProject, ensureProjectsMigrated, ensureProjectForDomain,
  mergeProjects, listMergeCandidates,
} from './projects.js';
import { createGroup, addTaskToGroup, applyGroupSchedule, listGroups, ensureGroups } from './groups.js';
import { deps } from './deps.js';
import { placeInInterval, weekdayNameFromYmd, stampActivityFromBlock } from './blocks.js';
import { renderImportHealth } from './import-plan.js';
import { singleCardHTML, commitSchedule } from './plan-card.js';
import { ensureSubtasks, takeFocusSubtaskId } from './plan-subtasks.js';

export {
  planToggleDraining, planAddBuffer, planRemoveBuffer,
  planAddSubtask, planSubtaskKey, planUpdateSubtask, planRemoveSubtask,
} from './plan-subtasks.js';

export {
  planComboOpen, planComboFilter, planComboBlur, planComboPickFromEl, planComboPick, planComboKey,
} from './plan-combo.js';

export {
  importWeeklyPlanFile,
  renderImportHealth,
  importWeeklyPlanRows,
  importWeeklyPlanJson,
  parseCsvText,
} from './import-plan.js';

function untagedTasks() {
  return state.tasks.filter(t => t.status !== 'someday' && !t.triaged && isTopLevelTask(t));
}

export function currentPlanTask() {
  if (state.planEditId) {
    return state.tasks.find(t => t.id === state.planEditId) || null;
  }
  const list = untagedTasks();
  if (!list.length) return null;
  let i = state.planWizardIndex || 0;
  if (i >= list.length) i = 0;
  state.planWizardIndex = i;
  return list[i];
}

export function planStartEdit(id) {
  state.planEditId = id;
  deps.save();
  renderPlan();
}

export function planStopEdit() {
  state.planEditId = null;
  deps.save();
  renderPlan();
}

export function planSetActivity(activity) {
  const t = currentPlanTask();
  if (!t) return;
  t.activity = activity;
  t.lane = activity;
  t.activitySource = 'manual';
  deps.save();
  renderPlanWizard();
}

export function planScheduleChanged() {
  const t = currentPlanTask();
  if (!t) return;
  const ymd = document.getElementById('plan-ymd')?.value || '';
  const interval = document.getElementById('plan-interval')?.value || '';
  if (!interval || !ymd) {
    placeInInterval(t, '', '');
  } else {
    placeInInterval(t, ymd, interval);
  }
  deps.save();
  renderPlanWizard();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function planSaveEdit() {
  const t = currentPlanTask();
  if (!t) return;
  commitDomainProject(t);
  commitParent(t);
  commitSchedule(t);
  t.triaged = true;
  state.planEditId = null;
  deps.save();
  renderPlan();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function markTriaged(t) {
  if (t) t.triaged = true;
}

export function addSingle() {
  const inp = document.getElementById('single-input');
  const val = inp && inp.value.trim();
  if (!val) return;
  state.tasks.push(newTask(val));
  if (inp) inp.value = '';
  deps.save();
  renderPlan();
}

export function toggleBulk() {
  const el = document.getElementById('bulk-area');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

export function importBulk() {
  const lines = (document.getElementById('bulk-input')?.value || '').split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(name => state.tasks.push(newTask(name)));
  const bulk = document.getElementById('bulk-input');
  if (bulk) bulk.value = '';
  toggleBulk();
  deps.save();
  renderPlan();
}

export function deleteTask(id) {
  state.tasks.forEach(t => { if (t.parentId === id) t.parentId = null; });
  state.tasks = state.tasks.filter(t => t.id !== id);
  if (state.planEditId === id) state.planEditId = null;
  if (state.dashEditId === id) state.dashEditId = null;
  deps.save();
  renderPlan();
}

function progressHTML() {
  const list = untagedTasks();
  const done = state.tasks.filter(t => t.triaged && t.status !== 'someday').length;
  const total = state.tasks.filter(t => t.status !== 'someday').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="plan-progress">
    <div class="plan-progress-bar"><i style="width:${pct}%"></i></div>
    <span>${done} / ${total} triaged · ${list.length} left</span>
  </div>`;
}

export function parentTaskLabel(parentId) {
  if (!parentId) return '';
  const p = state.tasks.find(x => x.id === parentId);
  return p ? p.name : '';
}

export function wouldCreateParentCycle(taskId, parentId) {
  if (!parentId || !taskId) return false;
  if (parentId === taskId) return true;
  let cur = state.tasks.find(x => x.id === parentId);
  const seen = new Set([taskId]);
  while (cur) {
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    if (!cur.parentId) break;
    cur = state.tasks.find(x => x.id === cur.parentId);
  }
  return false;
}

export function planPatch(partial) {
  const t = currentPlanTask();
  if (!t) return;
  Object.assign(t, partial);
  if ('lno' in partial) {
    t.lt = t.lno === 'L' ? true : t.lno === 'N' ? false : null;
  }
  if (partial.size === 'mid' || partial.size === 'complex') ensureSubtasks(t);
  if (partial.note != null) t.note = String(partial.note);
  if (partial.blockingNote != null) t.blockingNote = String(partial.blockingNote);
  if (partial.blocking === false) t.blockingNote = '';
  deps.save();
  renderPlanWizard();
}

export function planDomainChanged(dom) {
  const t = currentPlanTask();
  if (!t) return;
  t.domain = normalizeDomainId(dom) || 'Personal';
  // Clear project when domain changes — user re-picks / creates in new domain
  t.project = null;
  t.projectId = null;
  deps.save();
  renderPlanWizard();
}

function planTaskListHTML() {
  const roots = state.tasks
    .filter(t => t.status !== 'someday' && isTopLevelTask(t) && t.triaged && !t.done)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!roots.length) {
    return `<div class="plan-task-list"><div class="section-label">Tasks</div>
      <p class="dash-inbox-empty">No open tasks yet.</p></div>`;
  }
  const rows = roots.map(t => {
    const proj = getProject(t.projectId || t.project);
    const kids = childTasksOf(t.id);
    const childRows = kids.map(c => {
      const cproj = getProject(c.projectId || c.project);
      return `<div class="plan-task-row plan-task-child ${c.done ? 'done' : ''}">
        <div class="plan-task-row-main">
          <span class="plan-task-row-name">${esc(c.name)}</span>
          <span class="plan-task-row-tags">
            ${c.domain ? `<span class="tag">${esc(domainLabel(c.domain))}</span>` : ''}
            ${cproj ? `<span class="tag">${esc(cproj.name)}</span>` : ''}
          </span>
        </div>
        <button type="button" class="btn" onclick="planStartEdit('${c.id}')">Edit</button>
      </div>`;
    }).join('');
    return `<div class="plan-task-block">
      <div class="plan-task-row ${t.done ? 'done' : ''} ${!t.triaged ? 'untriaged' : ''}">
        <div class="plan-task-row-main">
          <span class="plan-task-row-name">${esc(t.name)}</span>
          <span class="plan-task-row-tags">
            ${t.domain ? `<span class="tag">${esc(domainLabel(t.domain))}</span>` : ''}
            ${proj ? `<span class="tag">${esc(proj.name)}</span>` : ''}
            ${!t.triaged ? '<span class="tag tag-warn">inbox</span>' : ''}
          </span>
        </div>
        <button type="button" class="btn" onclick="planStartEdit('${t.id}')">Edit</button>
      </div>
      ${childRows}
    </div>`;
  }).join('');
  return `<div class="plan-task-list">
    <div class="section-label">Tasks</div>
    ${rows}
  </div>`;
}

export function renderPlanWizard() {
  const root = document.getElementById('plan-wizard');
  if (!root) return;
  try {
    const editing = !!state.planEditId;
    const t = currentPlanTask();
    if (editing && !t) {
      state.planEditId = null;
    }
    const cardTask = currentPlanTask();
    let card = '';
    if (cardTask && (editing || !cardTask.triaged)) {
      card = singleCardHTML(cardTask);
    } else if (!editing) {
      card = `<div class="empty-state">All tasks triaged — edit below, open Dashboard, or add more above.</div>`;
    }
    root.innerHTML = progressHTML() + card + (editing ? '' : planTaskListHTML());
    const focusId = takeFocusSubtaskId();
    if (focusId) {
      const inp = root.querySelector(`.subtask-input[data-sid="${focusId}"]`);
      if (inp) { inp.focus(); inp.select?.(); }
    }
  } catch (e) {
    console.error('renderPlanWizard', e);
    root.innerHTML = `${progressHTML()}<div class="empty-state">Could not render triage card — see console.</div>`;
  }
}

function commitDomainProject(t) {
  const domRaw = document.getElementById('plan-domain')?.value
    || document.getElementById('plan-domain-q')?.value;
  const dom = normalizeDomainId(domRaw) || t.domain || 'Personal';
  t.domain = dom;

  const selected = document.getElementById('plan-project')?.value || '';
  const typed = (document.getElementById('plan-project-q')?.value || '').trim();
  if (selected && selected !== '__create__') {
    t.project = selected;
    t.projectId = selected;
  } else if (typed) {
    const pid = ensureProjectForDomain(dom, typed);
    t.project = pid;
    t.projectId = pid;
  } else if (!t.projectId) {
    const pid = ensureProjectForDomain(dom, domainLabel(dom));
    t.project = pid;
    t.projectId = pid;
  }
  const note = document.getElementById('plan-note');
  if (note) t.note = note.value.trim();
  const blockingNote = document.getElementById('plan-blocking-note');
  if (blockingNote) t.blockingNote = blockingNote.value.trim();
  else if (!t.blocking) t.blockingNote = '';
  stampActivityFromBlock(t);
}

function commitParent(t) {
  const raw = document.getElementById('plan-parent')?.value || '';
  const parentId = raw || null;
  if (parentId && wouldCreateParentCycle(t.id, parentId)) {
    t.parentId = null;
    return;
  }
  t.parentId = parentId;
}

function advance() {
  const t = currentPlanTask();
  if (t) markTriaged(t);
  state.planWizardIndex = 0;
  deps.save();
  renderPlan();
}

export function planFinish(mode) {
  const t = currentPlanTask();
  if (!t) return;
  commitDomainProject(t);
  commitParent(t);
  const day = (weekdayNameFromYmd(document.getElementById('plan-ymd')?.value) || 'monday').toLowerCase();
  const slot = 'afternoon';

  if (mode === 'none') {
    placeInInterval(t, '', '');
  } else if (mode === 'slot') {
    commitSchedule(t);
    if (!t.duration) t.duration = 30;
  } else if (mode === 'batch') {
    let gid = document.getElementById('plan-group')?.value;
    if (!gid) {
      const name = (document.getElementById('plan-group-name')?.value || '').trim() || 'Batch';
      const g = createGroup({ name, preferredDay: day, preferredStart: slot, taskIds: [t.id] });
      gid = g.id;
    } else {
      addTaskToGroup(gid, t.id);
      const g = listGroups().find(x => x.id === gid);
      if (g) {
        g.preferredDay = day;
        g.preferredStart = slot;
      }
    }
    applyGroupSchedule(gid);
  }
  advance();
}

export function renderMergePanel() {
  const el = document.getElementById('merge-projects-panel');
  if (!el) return;
  const cands = listMergeCandidates();
  if (cands.length < 2) {
    el.innerHTML = '<p class="dash-inbox-empty">Need at least two projects to merge.</p>';
    return;
  }
  const opts = cands.map(c =>
    `<option value="${c.id}">${esc(c.name)} (${c.taskCount}) · ${(c.domains || []).join(', ')}</option>`
  ).join('');
  el.innerHTML = `
    <div class="section-label">Merge projects</div>
    <p class="bulk-hint">Pick a survivor, then sources to absorb. Tasks move; empty customs are removed.</p>
    <div class="merge-grid">
      <label>Survivor<select id="merge-survivor">${opts}</select></label>
      <label>Absorb (multi)
        <select id="merge-sources" multiple size="6">${opts}</select>
      </label>
    </div>
    <button type="button" class="btn primary" onclick="runMergeProjects()">Merge</button>
    <p id="merge-msg" class="bulk-hint"></p>`;
}

export function runMergeProjects() {
  const survivor = document.getElementById('merge-survivor')?.value;
  const srcSel = document.getElementById('merge-sources');
  const sources = srcSel ? [...srcSel.selectedOptions].map(o => o.value) : [];
  const msg = document.getElementById('merge-msg');
  const res = mergeProjects(survivor, sources);
  if (msg) msg.textContent = res.ok ? `Merged ${res.merged} into survivor.` : (res.error || 'Merge failed');
  deps.save();
  renderMergePanel();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

export function renderPlan() {
  ensureProjectsMigrated();
  ensureGroups();
  renderPlanWizard();
  renderMergePanel();
  renderImportHealth();
  const batches = document.getElementById('plan-batches');
  if (batches) {
    const gs = listGroups();
    batches.innerHTML = gs.length
      ? `<div class="section-label">Execution batches</div>
        <ul class="plan-batch-list">${gs.map(g => {
          const n = g.taskIds.length;
          const win = g.preferredDay ? `${g.preferredDay} ${g.preferredStart || ''}` : 'no window';
          return `<li><strong>${esc(g.name)}</strong> · ${n} tasks · ${esc(win)}
            <button type="button" class="btn" onclick="applyGroupSchedule('${g.id}')">Apply window</button></li>`;
        }).join('')}</ul>`
      : '';
  }
}

export function renderTriage() { renderPlan(); }
export function setLNO(id, val) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.lno = val === 'L' || val === 'N' || val === 'O' ? val : null;
  deps.save();
  renderPlan();
}
export function toggleDraining(id) {
  const t = state.tasks.find(x => x.id === id);
  if (t) { t.draining = !t.draining; deps.save(); renderPlan(); }
}

// Legacy no-ops kept for any stray onclick
export function planWizardBack() {}
export function planSetSize(size) { planPatch({ size }); }
export function planSetLNO(val) { planPatch({ lno: val }); }
export function planSetBlocking(val) { planPatch({ blocking: val }); }
export function planCommitBlocking() { planFinish('none'); }
export function planCommitDomain() { planFinish('none'); }
export function planScheduleUnscheduled() { planFinish('none'); }
export function planScheduleSlot() { planFinish('slot'); }
export function planScheduleBatch() { planFinish('batch'); }
