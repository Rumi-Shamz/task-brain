/** 01 Plan — single-screen triage + batches + merge projects. */
import {
  state, esc, newTask, formatYmd, addDaysLocal, mondayOnOrBefore, formatHHMM, uid, BUFFERS,
} from './state.js';
import { allDomains, domainLabel, normalizeDomainId } from './domains.js';
import {
  ensureProjectsMigrated, ensureProjectForDomain,
  mergeProjects, listMergeCandidates, projectsInDomain,
} from './projects.js';
import { createGroup, addTaskToGroup, applyGroupSchedule, listGroups, ensureGroups } from './groups.js';
import { deps } from './deps.js';

export {
  importWeeklyPlanFile,
  importWeeklyPlanRows,
  importWeeklyPlanJson,
  parseCsvText,
} from './import-plan.js';

const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };

function untagedTasks() {
  return state.tasks.filter(t => t.status !== 'someday' && !t.triaged);
}

export function currentPlanTask() {
  const list = untagedTasks();
  if (!list.length) return null;
  let i = state.planWizardIndex || 0;
  if (i >= list.length) i = 0;
  state.planWizardIndex = i;
  return list[i];
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
  state.tasks = state.tasks.filter(t => t.id !== id);
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

function ensureSubtasks(t) {
  if (!Array.isArray(t.subtasks)) t.subtasks = [];
  if (t.size !== 'mid' && t.size !== 'complex') return;
  // Always keep one trailing empty input for quick Enter-to-next entry
  const last = t.subtasks[t.subtasks.length - 1];
  if (!last || String(last.text || '').trim()) {
    if (t.subtasks.length < 9) t.subtasks.push({ id: uid(), text: '' });
  }
}

function subtasksHTML(t) {
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

function drainingHTML(t) {
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

function singleCardHTML(t) {
  ensureProjectsMigrated();
  ensureGroups();
  const domain = normalizeDomainId(t.domain) || 'Personal';
  const projects = projectsInDomain(domain);
  const groups = listGroups();
  const pid = t.projectId || t.project || '';
  return `<div class="plan-q">
    <div class="plan-task-head">
      <p class="plan-task-name">${esc(t.name)}</p>
      <span class="task-del" onclick="deleteTask('${t.id}')" title="Delete">✕</span>
    </div>

    <div class="plan-row ${t.blocking === true ? 'plan-row-4' : 'plan-row-3'}">
      <div class="plan-field">Size
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.size === 'simple' ? 'primary' : ''}" onclick="planPatch({size:'simple'})">Simple</button>
          <button type="button" class="btn ${t.size === 'mid' ? 'primary' : ''}" onclick="planPatch({size:'mid'})">Mid</button>
          <button type="button" class="btn ${t.size === 'complex' ? 'primary' : ''}" onclick="planPatch({size:'complex'})">Complex</button>
        </div>
      </div>
      <div class="plan-field">LNO
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.lno === 'L' ? 'primary' : ''}" onclick="planPatch({lno:'L'})">L</button>
          <button type="button" class="btn ${t.lno === 'N' ? 'primary' : ''}" onclick="planPatch({lno:'N'})">N</button>
          <button type="button" class="btn ${t.lno === 'O' ? 'primary' : ''}" onclick="planPatch({lno:'O'})">O</button>
          <button type="button" class="btn ${!t.lno ? 'primary' : ''}" onclick="planPatch({lno:null})">—</button>
        </div>
      </div>
      <div class="plan-field">Blocking
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.blocking === true ? 'primary' : ''}" onclick="planPatch({blocking:true})">Yes</button>
          <button type="button" class="btn ${t.blocking === false ? 'primary' : ''}" onclick="planPatch({blocking:false})">No</button>
        </div>
      </div>
      ${t.blocking === true ? `
        <label class="plan-field">Blocks
          <input type="text" id="plan-blocking-note"
            value="${esc(t.blockingNote || '')}"
            placeholder="Who / what it blocks"
            onchange="planPatch({blockingNote:this.value})" />
        </label>
      ` : ''}
    </div>

    <div class="plan-row plan-row-2">
      <div class="plan-field">Domain
        ${comboHTML('domain', {
          valueId: domain,
          valueLabel: domainLabel(domain),
          placeholder: 'Search domain…',
        })}
      </div>
      <div class="plan-field">Project
        ${comboHTML('project', {
          valueId: pid,
          valueLabel: projects.find(p => p.id === pid)?.name || '',
          placeholder: 'Search or create project…',
        })}
      </div>
    </div>

    <div class="plan-row plan-row-full">
      <div class="plan-field plan-note-col">
        <span>Note</span>
        <textarea id="plan-note" rows="3" placeholder="optional note" onchange="planPatch({note:this.value})">${esc(t.note || '')}</textarea>
        ${subtasksHTML(t)}
      </div>
    </div>

    <div class="plan-row plan-row-2">
      <div class="plan-field">Schedule
        <div class="plan-pair">
          <label class="plan-field">Weekday
            <select id="plan-weekday">
              ${['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d =>
                `<option value="${d}">${d}</option>`).join('')}
            </select>
          </label>
          <label class="plan-field">Slot
            <select id="plan-slot">
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </label>
        </div>
      </div>
      <div class="plan-field">Batch
        <div class="plan-pair">
          <label class="plan-field">Existing
            <select id="plan-group">
              <option value="">New batch…</option>
              ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
            </select>
          </label>
          <label class="plan-field">Name
            <input type="text" id="plan-group-name" placeholder="Batch name (e.g. Calls)" />
          </label>
        </div>
      </div>
    </div>

    ${drainingHTML(t)}

    <div class="plan-step-actions">
      <button type="button" class="btn primary" onclick="planFinish('slot')">Next · set slot</button>
      <button type="button" class="btn" onclick="planFinish('batch')">Next · add to batch</button>
      <button type="button" class="btn" onclick="planFinish('none')">Next · leave open</button>
    </div>
  </div>`;
}

let focusSubtaskId = null;
let comboHighlight = { domain: -1, project: -1 };

function comboHTML(kind, { valueId, valueLabel, placeholder }) {
  return `<div class="plan-combo" data-combo="${kind}">
    <input type="text" id="plan-${kind}-q" class="plan-combo-q" role="combobox"
      aria-autocomplete="list" aria-expanded="false" aria-controls="plan-${kind}-list"
      autocomplete="off" placeholder="${esc(placeholder)}"
      value="${esc(valueLabel || '')}"
      onfocus="planComboOpen('${kind}')"
      oninput="planComboFilter('${kind}')"
      onkeydown="planComboKey(event,'${kind}')"
      onblur="planComboBlur('${kind}')" />
    <input type="hidden" id="plan-${kind}" value="${esc(valueId || '')}" />
    <ul class="plan-combo-list" id="plan-${kind}-list" role="listbox" hidden></ul>
  </div>`;
}

function comboOptions(kind, query) {
  const q = String(query || '').trim().toLowerCase();
  if (kind === 'domain') {
    return allDomains()
      .filter(d => !q || d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q))
      .map(d => ({ id: d.id, label: d.label, create: false }));
  }
  const t = currentPlanTask();
  const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || t?.domain) || 'Personal';
  const projects = projectsInDomain(dom);
  const matches = projects
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .map(p => ({ id: p.id, label: p.name, create: false }));
  const exact = projects.some(p => p.name.toLowerCase() === q);
  if (q && !exact) {
    matches.push({ id: '__create__', label: `Create “${query.trim()}”`, create: true, name: query.trim() });
  }
  return matches;
}

function renderComboList(kind, queryOverride) {
  const qEl = document.getElementById(`plan-${kind}-q`);
  const list = document.getElementById(`plan-${kind}-list`);
  if (!qEl || !list) return;
  const query = queryOverride !== undefined ? queryOverride : qEl.value;
  const opts = comboOptions(kind, query);
  if (comboHighlight[kind] >= opts.length) comboHighlight[kind] = opts.length - 1;
  list.innerHTML = opts.length
    ? opts.map((o, i) => `<li role="option" class="plan-combo-opt ${o.create ? 'create' : ''} ${i === comboHighlight[kind] ? 'active' : ''}"
        data-id="${esc(o.id)}" data-name="${esc(o.create ? o.name : o.label)}" data-create="${o.create ? '1' : '0'}"
        onmousedown="event.preventDefault();planComboPickFromEl('${kind}',this)">${esc(o.label)}</li>`).join('')
    : `<li class="plan-combo-empty">No matches</li>`;
  list.hidden = false;
  qEl.setAttribute('aria-expanded', 'true');
}

export function planComboOpen(kind) {
  comboHighlight[kind] = 0;
  const qEl = document.getElementById(`plan-${kind}-q`);
  const hidden = document.getElementById(`plan-${kind}`);
  // Opening on a committed value: show full list, select text for quick retype/search
  if (qEl && hidden?.value && hidden.value !== '__create__') {
    renderComboList(kind, '');
    qEl.select();
    return;
  }
  renderComboList(kind);
}

export function planComboFilter(kind) {
  const hidden = document.getElementById(`plan-${kind}`);
  // Typing clears committed id until a pick / blur resolve
  if (hidden) hidden.value = '';
  comboHighlight[kind] = 0;
  renderComboList(kind);
}

export function planComboBlur(kind) {
  setTimeout(() => {
    const list = document.getElementById(`plan-${kind}-list`);
    const qEl = document.getElementById(`plan-${kind}-q`);
    const hidden = document.getElementById(`plan-${kind}`);
    if (!qEl || !hidden) return;
    if (list) { list.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
    // Resolve typed text to a match or (project) create-on-commit marker
    const q = qEl.value.trim();
    if (!q) {
      if (kind === 'domain') {
        const t = currentPlanTask();
        const id = t?.domain || 'Personal';
        hidden.value = id;
        qEl.value = domainLabel(id);
      }
      return;
    }
    if (kind === 'domain') {
      const ql = q.toLowerCase();
      const hit = allDomains().find(d => d.label.toLowerCase() === ql || d.id.toLowerCase() === ql)
        || allDomains().find(d => d.label.toLowerCase().startsWith(ql))
        || null;
      const id = hit?.id || normalizeDomainId(q) || currentPlanTask()?.domain || 'Personal';
      if (hidden.value !== id) planDomainChanged(id);
      else { hidden.value = id; qEl.value = domainLabel(id); }
      return;
    }
    // project
    if (hidden.value && hidden.value !== '__create__') {
      const t = currentPlanTask();
      const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || t?.domain) || 'Personal';
      const p = projectsInDomain(dom).find(x => x.id === hidden.value);
      if (p) qEl.value = p.name;
      return;
    }
    const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || currentPlanTask()?.domain) || 'Personal';
    const hit = projectsInDomain(dom).find(p => p.name.toLowerCase() === q.toLowerCase());
    if (hit) {
      hidden.value = hit.id;
      qEl.value = hit.name;
    } else {
      hidden.value = '__create__';
      // keep typed name in the query field for commit
    }
  }, 120);
}

export function planComboPickFromEl(kind, el) {
  if (!el) return;
  planComboPick(kind, el.dataset.id, el.dataset.create === '1' ? el.dataset.name : null);
}

export function planComboPick(kind, id, createName) {
  const qEl = document.getElementById(`plan-${kind}-q`);
  const hidden = document.getElementById(`plan-${kind}`);
  const list = document.getElementById(`plan-${kind}-list`);
  if (!qEl || !hidden) return;
  if (kind === 'domain') {
    planDomainChanged(id);
    return;
  }
  if (id === '__create__' || createName) {
    hidden.value = '__create__';
    qEl.value = createName || qEl.value.trim();
  } else {
    hidden.value = id;
    const t = currentPlanTask();
    const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || t?.domain) || 'Personal';
    const p = projectsInDomain(dom).find(x => x.id === id);
    qEl.value = p ? p.name : qEl.value;
  }
  if (list) { list.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
}

export function planComboKey(e, kind) {
  const list = document.getElementById(`plan-${kind}-list`);
  if (!list || list.hidden) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      planComboOpen(kind);
    }
    return;
  }
  const opts = [...list.querySelectorAll('.plan-combo-opt')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    comboHighlight[kind] = Math.min(opts.length - 1, (comboHighlight[kind] ?? -1) + 1);
    renderComboList(kind);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    comboHighlight[kind] = Math.max(0, (comboHighlight[kind] ?? 0) - 1);
    renderComboList(kind);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const i = comboHighlight[kind] ?? 0;
    const opt = opts[i];
    if (opt) planComboPickFromEl(kind, opt);
  } else if (e.key === 'Escape') {
    list.hidden = true;
    document.getElementById(`plan-${kind}-q`)?.setAttribute('aria-expanded', 'false');
  }
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

export function renderPlanWizard() {
  const root = document.getElementById('plan-wizard');
  if (!root) return;
  try {
    const t = currentPlanTask();
    if (!t) {
      root.innerHTML = `${progressHTML()}<div class="empty-state">All tasks triaged — open Dashboard to execute, or add more above.</div>`;
      return;
    }
    root.innerHTML = progressHTML() + singleCardHTML(t);
    if (focusSubtaskId) {
      const inp = root.querySelector(`.subtask-input[data-sid="${focusSubtaskId}"]`);
      if (inp) { inp.focus(); inp.select?.(); }
      focusSubtaskId = null;
    }
  } catch (e) {
    console.error('renderPlanWizard', e);
    root.innerHTML = `${progressHTML()}<div class="empty-state">Could not render triage card — see console.</div>`;
  }
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
  const day = (document.getElementById('plan-weekday')?.value || 'monday').toLowerCase();
  const slot = (document.getElementById('plan-slot')?.value || 'morning').toLowerCase();

  if (mode === 'none') {
    t.date = null;
    t.start = null;
  } else if (mode === 'slot') {
    if (DAY_OFFSET[day] != null && SLOT_START[slot] != null) {
      const mon = mondayOnOrBefore(new Date());
      t.date = formatYmd(addDaysLocal(mon, DAY_OFFSET[day]));
      t.start = formatHHMM(SLOT_START[slot]);
      if (!t.duration) t.duration = 30;
    }
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
