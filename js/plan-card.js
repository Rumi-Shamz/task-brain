/** Plan card markup for one task, and committing its Day / When choice. */
import { state, esc, formatYmd } from './state.js';
import { domainLabel, normalizeDomainId } from './domains.js';
import { ensureProjectsMigrated, projectsInDomain } from './projects.js';
import { ensureGroups, listGroups } from './groups.js';
import { DAY_INTERVALS, intervalForTask, placeInInterval, upcomingWorkDates, weekdayNameFromYmd } from './blocks.js';
import { parentTaskLabel } from './plan.js';
import { comboHTML } from './plan-combo.js';
import { subtasksHTML, drainingHTML } from './plan-subtasks.js';

function scheduleFieldsHTML(t) {
  const today = formatYmd(new Date());
  const dates = upcomingWorkDates();
  if (t.date && t.date >= today && !dates.includes(t.date)) dates.unshift(t.date);
  const selected = dates.includes(t.date) ? t.date : '';
  const shownDay = selected || dates[0] || '';
  const cur = selected ? intervalForTask(t) : '';
  return `<div class="plan-pair">
    <label class="plan-field">Day
      <select id="plan-ymd" onchange="planScheduleChanged()">
        ${dates.map(d => `<option value="${d}" ${d === shownDay ? 'selected' : ''}>${weekdayNameFromYmd(d)} ${d.slice(5)}</option>`).join('') || '<option value="">No open work day</option>'}
      </select>
    </label>
    <label class="plan-field">When
      <select id="plan-interval" onchange="planScheduleChanged()">
        <option value="" ${!cur ? 'selected' : ''}>Leave open</option>
        ${DAY_INTERVALS.map(i => `<option value="${i.id}" title="${esc(i.focus)}" ${i.id === cur ? 'selected' : ''}>${esc(i.label)} · ${esc(i.focus)}</option>`).join('')}
      </select>
    </label>
  </div>`;
}

export function commitSchedule(t) {
  const ymd = document.getElementById('plan-ymd')?.value || '';
  const interval = document.getElementById('plan-interval')?.value || '';
  if (!ymd || !interval) return;
  placeInInterval(t, ymd, interval);
}

export function singleCardHTML(t) {
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

    <div class="plan-row plan-main-row ${t.blocking === true ? 'plan-row-4' : 'plan-row-3'}">
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
        <label class="plan-field plan-blocking-note">Blocks
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
      </div>
    </div>

    <div class="plan-row plan-row-full">
      <div class="plan-field">Who does it
        <div class="plan-choices compact">
          ${[['me', 'Me'], ['person', 'Someone else'], ['ai', 'Assistant']].map(([v, l]) =>
            `<button type="button" class="btn ${t.assignee === v ? 'primary' : ''}" onclick="planPatch({assignee:'${v}'})">${l}</button>`
          ).join('')}
        </div>
        ${t.assignee === 'person' ? `<input type="text" placeholder="Who? (name)" value="${esc(t.delegateTo || '')}"
          onchange="planPatch({delegateTo:this.value})" />` : ''}
        ${t.assignee === 'ai' ? '<span class="bulk-hint">The note above is the brief. It waits in Delegated until the assistant can run it.</span>' : ''}
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
