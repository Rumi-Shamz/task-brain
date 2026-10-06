/** Today: the task edit sheet (name, domain, project, activity, day, time of day, duration). */
import { state, esc, ensureDashCalDate } from './state.js';
import { allDomains, normalizeDomainId } from './domains.js';
import { ACTIVITIES, projectsInDomain, ensureProjectForDomain } from './projects.js';
import { deps } from './deps.js';
import { DAY_INTERVALS, KEEP_TIME, intervalForTask, placeInInterval, placementUnchanged, isTaskDay } from './blocks.js';
import { renderDashboard } from './dashboard.js';

export function openDashEdit(id) {
  state.dashEditId = id;
  renderDashEditSheet();
}

export function closeDashEdit() {
  state.dashEditId = null;
  const el = document.getElementById('dash-edit-sheet');
  if (el) el.remove();
}

export function saveDashEdit() {
  const t = state.tasks.find(x => x.id === state.dashEditId);
  if (!t) { closeDashEdit(); return; }
  const name = document.getElementById('de-name')?.value.trim();
  if (name) t.name = name;
  const dom = normalizeDomainId(document.getElementById('de-domain')?.value) || t.domain || 'Personal';
  t.domain = dom;
  const projRaw = (document.getElementById('de-project')?.value || '').trim();
  if (projRaw) {
    const existing = projectsInDomain(dom).find(p => p.id === projRaw || p.name.toLowerCase() === projRaw.toLowerCase());
    const pid = existing ? existing.id : ensureProjectForDomain(dom, projRaw);
    t.project = pid;
    t.projectId = pid;
  }
  const act = document.getElementById('de-activity')?.value || 'act';
  t.activity = act;
  t.lane = act === 'research' ? 'research' : act;
  t.note = (document.getElementById('de-note')?.value || '').trim();
  t.done = !!document.getElementById('de-done')?.checked;
  const ymd = document.getElementById('de-ymd')?.value || '';
  const interval = document.getElementById('de-interval')?.value || '';
  const dur = parseInt(document.getElementById('de-duration')?.value || '', 10);
  if (Number.isFinite(dur) && dur > 0) t.duration = dur;
  // Only re-place when the user changed the day or the window; otherwise a rename would move the task
  // to the first free minute of its window (or clear it, if it sits outside every window).
  if (!placementUnchanged(t, ymd, interval)) {
    if (!interval || !ymd) placeInInterval(t, '', '');
    else placeInInterval(t, ymd, interval);
  }
  deps.save();
  closeDashEdit();
  deps.renderDashboard();
}

export function renderDashEditSheet() {
  let el = document.getElementById('dash-edit-sheet');
  if (!state.dashEditId) {
    if (el) el.remove();
    return;
  }
  const t = state.tasks.find(x => x.id === state.dashEditId);
  if (!t) { closeDashEdit(); return; }
  const domain = normalizeDomainId(t.domain) || 'Personal';
  const projects = projectsInDomain(domain);
  const pid = t.projectId || t.project || '';
  const act = t.activity || t.lane || 'act';
  const scheduled = !!(t.date && t.start);
  const schedMode = scheduled ? 'exact' : 'none';
  if (!el) {
    el = document.createElement('div');
    el.id = 'dash-edit-sheet';
    document.body.appendChild(el);
  }
  el.className = 'dash-edit-sheet';
  el.innerHTML = `
    <div class="dash-edit-backdrop" onclick="closeDashEdit()"></div>
    <div class="dash-edit-panel" role="dialog" aria-label="Edit task">
      <div class="dash-edit-head">
        <strong>Edit task</strong>
        <button type="button" class="btn" onclick="closeDashEdit()">Close</button>
      </div>
      <label class="plan-field">Name
        <input type="text" id="de-name" value="${esc(t.name)}" />
      </label>
      <div class="plan-row plan-row-2">
        <label class="plan-field">Domain
          <select id="de-domain">${allDomains().map(d =>
            `<option value="${esc(d.id)}" ${d.id === domain ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}
          </select>
        </label>
        <label class="plan-field">Project
          <select id="de-project">
            <option value="">—</option>
            ${projects.map(p => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label class="plan-field">Activity
        <select id="de-activity">${ACTIVITIES.map(a =>
          `<option value="${a.id}" ${a.id === act ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
        </select>
      </label>
      <div class="plan-field">Schedule
        ${dashPlacementHTML(t)}
      </div>
      <label class="plan-field">Note
        <textarea id="de-note" rows="3">${esc(t.note || '')}</textarea>
      </label>
      <label class="dash-edit-done"><input type="checkbox" id="de-done" ${t.done ? 'checked' : ''} /> Done</label>
      <div class="plan-step-actions">
        <button type="button" class="btn primary" onclick="saveDashEdit()">Save</button>
        <button type="button" class="btn" onclick="closeDashEdit()">Cancel</button>
      </div>
    </div>`;
}

function dashPlacementHTML(t) {
  const ymd = t.date || ensureDashCalDate();
  const cur = t.date ? intervalForTask(t) : '';
  const exact = t.date && t.start && !cur;
  const open = isTaskDay(ymd);
  return `<div class="plan-pair">
    <label class="plan-field">Day
      <input type="date" id="de-ymd" value="${esc(ymd)}" />
    </label>
    <label class="plan-field">When
      <select id="de-interval">
        ${exact ? `<option value="${KEEP_TIME}" selected>Keep ${esc(t.start)}</option>` : ''}
        <option value="">Leave open</option>
        ${DAY_INTERVALS.map(i => `<option value="${i.id}" title="${esc(i.focus)}" ${i.id === cur ? 'selected' : ''}>${esc(i.label)} · ${esc(i.focus)}</option>`).join('')}
      </select>
    </label>
    <label class="plan-field">Duration
      <select id="de-duration">
        ${[15, 30, 60, 180].map(n => `<option value="${n}" ${Number(t.duration) === n ? 'selected' : ''}>${n} min</option>`).join('')}
      </select>
    </label>
  </div>${open ? '' : '<p class="bulk-hint">That day is not a work or sprint day. Pick another day, or leave it open.</p>'}`;
}
