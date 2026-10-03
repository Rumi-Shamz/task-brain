/** 01 Plan — single-screen triage + batches + merge projects. */
import {
  state, esc, newTask, formatYmd, addDaysLocal, mondayOnOrBefore, formatHHMM, uid, BUFFERS,
  isTopLevelTask, childTasksOf,
} from './state.js';
import { allDomains, domainLabel, normalizeDomainId } from './domains.js';
import {
  getProject, ensureProjectsMigrated, ensureProjectForDomain,
  mergeProjects, listMergeCandidates, projectsInDomain,
} from './projects.js';
import { createGroup, addTaskToGroup, applyGroupSchedule, listGroups, ensureGroups } from './groups.js';
import { deps } from './deps.js';
import {
  placementsFor, applyPlacement, currentPlacementId, thisWeekWorkDates,
  weekdayNameFromYmd, stampActivityFromBlock, suggestRule, saveActivityRule,
} from './blocks.js';

export {
  importWeeklyPlanFile,
  importWeeklyPlanRows,
  importWeeklyPlanJson,
  parseCsvText,
} from './import-plan.js';

const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };

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
  const prev = t.activity;
  t.activity = activity;
  t.lane = activity;
  t.activitySource = 'manual';
  if (prev !== activity) {
    const suggestion = suggestRule(t, activity);
    state.ruleOffer = suggestion ? { ...suggestion, taskId: t.id } : null;
  }
  deps.save();
  renderPlanWizard();
}

export function planAcceptRule() {
  const offer = state.ruleOffer;
  if (offer) saveActivityRule(offer);
  state.ruleOffer = null;
  deps.save();
  renderPlanWizard();
}

export function planDismissRule() {
  state.ruleOffer = null;
  renderPlanWizard();
}

export function planScheduleChanged() {
  const t = currentPlanTask();
  if (!t) return;
  const ymd = document.getElementById('plan-ymd')?.value || '';
  const place = document.getElementById('plan-place')?.value || '';
  const free = document.getElementById('plan-free-start')?.value || '09:00';
  if (!place) {
    if (t.replacesBlockId && t.date) {
      state.blockSkips = (state.blockSkips || []).filter(s => !(s.date === t.date && s.blockId === t.replacesBlockId && s.taskId === t.id));
    }
    t.date = null;
    t.start = null;
    t.blockId = null;
    t.replacesBlockId = null;
  } else if (ymd) {
    applyPlacement(t, ymd, place, free);
    state.dashCalDate = ymd;
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
  if (t.date) state.dashCalDate = t.date;
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

function parentTaskLabel(parentId) {
  if (!parentId) return '';
  const p = state.tasks.find(x => x.id === parentId);
  return p ? p.name : '';
}

function wouldCreateParentCycle(taskId, parentId) {
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

function scheduleFieldsHTML(t) {
  const dates = thisWeekWorkDates();
  const selected = dates.includes(t.date) ? t.date : '';
  const opts = selected ? placementsFor(t, selected) : (dates[0] ? placementsFor(t, dates[0]) : []);
  const shownDay = selected || dates[0] || '';
  const cur = selected ? currentPlacementId(t) : '';
  return `<div class="plan-pair">
    <label class="plan-field">Day
      <select id="plan-ymd" onchange="planScheduleChanged()">
        ${dates.map(d => `<option value="${d}" ${d === shownDay ? 'selected' : ''}>${weekdayNameFromYmd(d)} ${d.slice(5)}</option>`).join('') || '<option value="">No open work day</option>'}
      </select>
    </label>
    <label class="plan-field">Place
      <select id="plan-place" onchange="planScheduleChanged()">
        <option value="" ${!cur ? 'selected' : ''}>Leave open</option>
        ${opts.map(o => `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>
    </label>
    <label class="plan-field" id="plan-free-wrap" style="${cur === 'free' ? '' : 'display:none'}">Start
      <input type="time" id="plan-free-start" value="${esc((cur === 'free' && t.start) || '09:00')}" onchange="planScheduleChanged()" />
    </label>
  </div>`;
}

function ruleOfferHTML(t) {
  const offer = state.ruleOffer;
  if (!offer || offer.taskId !== t.id) return '';
  return `<p class="bulk-hint">Save a rule so ${esc(offer.label)} maps to ${esc(offer.activity)}?
    <button type="button" class="btn" onclick="planAcceptRule()">Save rule</button>
    <button type="button" class="btn" onclick="planDismissRule()">Not now</button></p>`;
}

function commitSchedule(t) {
  const ymd = document.getElementById('plan-ymd')?.value || '';
  const place = document.getElementById('plan-place')?.value || '';
  const free = document.getElementById('plan-free-start')?.value || t.start || '09:00';
  if (!ymd || !place) return;
  applyPlacement(t, ymd, place, free);
}

function singleCardHTML(t) {
  ensureProjectsMigrated();
  ensureGroups();
  const editing = !!state.planEditId;
  const domain = normalizeDomainId(t.domain) || 'Personal';
  const projects = projectsInDomain(domain);
  const groups = listGroups();
  const pid = t.projectId || t.project || '';
  return `<div class="plan-q ${editing ? 'plan-q-edit' : ''}">
    <div class="plan-task-head">
      <p class="plan-task-name">${esc(t.name)}${editing ? ' <span class="plan-edit-badge">editing</span>' : ''}</p>
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
          <button type="button" class="btn ${t.lno === 'L' ? 'primary' : ''}" onclick="planPatch({lno:'L'})" title="10x return — best energy">Leverage</button>
          <button type="button" class="btn ${t.lno === 'N' ? 'primary' : ''}" onclick="planPatch({lno:'N'})" title="Do it well enough">Neutral</button>
          <button type="button" class="btn ${t.lno === 'O' ? 'primary' : ''}" onclick="planPatch({lno:'O'})" title="Minimize, batch, delegate first">Optional</button>
          <button type="button" class="btn ${!t.lno ? 'primary' : ''}" onclick="planPatch({lno:null})" title="Unset">—</button>
        </div>
      </div>
      <div class="plan-field plan-length-pills">Length
        <div class="plan-choices compact">
          ${[15, 30, 60, 180].map(n =>
            `<button type="button" class="btn ${Number(t.duration) === n ? 'primary' : ''}" onclick="planPatch({duration:${n}})">${n}</button>`
          ).join('')}
        </div>
      </div>
      <label class="plan-field plan-length-select">Length
        <select onchange="planPatch({duration:Number(this.value)})">
          ${[15, 30, 60, 180].map(n =>
            `<option value="${n}" ${Number(t.duration) === n ? 'selected' : ''}>${n} min</option>`
          ).join('')}
        </select>
      </label>
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
      <div class="plan-field">Parent task
        ${comboHTML('parent', {
          valueId: t.parentId || '',
          valueLabel: parentTaskLabel(t.parentId),
          placeholder: 'Optional — become a subtask of…',
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

    <div class="plan-row plan-row-full">
      <div class="plan-field">Activity
        <div class="plan-choices compact">
          ${['research', 'communicate', 'act', 'learn'].map(a =>
            `<button type="button" class="btn ${t.activity === a ? 'primary' : ''}" onclick="planSetActivity('${a}')">${a[0].toUpperCase()}${a.slice(1)}</button>`
          ).join('')}
        </div>
        ${ruleOfferHTML(t)}
      </div>
    </div>

    <div class="plan-row plan-row-2">
      <div class="plan-field">Schedule
        ${scheduleFieldsHTML(t)}
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
      ${editing ? `
        <button type="button" class="btn primary" onclick="planSaveEdit()">Save</button>
        <button type="button" class="btn" onclick="planStopEdit()">Back to list</button>
      ` : `
        <button type="button" class="btn primary" onclick="planFinish('slot')">Next · set slot</button>
        <button type="button" class="btn" onclick="planFinish('batch')">Next · add to batch</button>
        <button type="button" class="btn" onclick="planFinish('none')">Next · leave open</button>
      `}
    </div>
  </div>`;
}

let focusSubtaskId = null;
let comboHighlight = { domain: -1, project: -1, parent: -1 };

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
  if (kind === 'parent') {
    const t = currentPlanTask();
    const opts = [{ id: '', label: '— None (top-level) —', create: false }];
    state.tasks
      .filter(x => x.status !== 'someday' && x.id !== t?.id && !wouldCreateParentCycle(t?.id, x.id))
      .filter(x => !q || x.name.toLowerCase().includes(q))
      .slice(0, 40)
      .forEach(x => opts.push({ id: x.id, label: x.name, create: false }));
    return opts;
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
      } else if (kind === 'parent') {
        hidden.value = '';
        qEl.value = '';
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
    if (kind === 'parent') {
      if (hidden.value) {
        qEl.value = parentTaskLabel(hidden.value);
        return;
      }
      const hit = state.tasks.find(x => x.status !== 'someday' && x.name.toLowerCase() === q.toLowerCase());
      if (hit && !wouldCreateParentCycle(currentPlanTask()?.id, hit.id)) {
        hidden.value = hit.id;
        qEl.value = hit.name;
      } else {
        hidden.value = '';
        qEl.value = '';
      }
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
  if (kind === 'parent') {
    const t = currentPlanTask();
    if (id && wouldCreateParentCycle(t?.id, id)) {
      hidden.value = '';
      qEl.value = '';
    } else {
      hidden.value = id || '';
      qEl.value = id ? parentTaskLabel(id) : '';
    }
    if (list) { list.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
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
    t.date = null;
    t.start = null;
    t.blockId = null;
    t.replacesBlockId = null;
  } else if (mode === 'slot') {
    commitSchedule(t);
    if (t.date) state.dashCalDate = t.date;
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
