/** Plan card markup for one task, and committing its Day / When choice. */
import { state, esc, formatYmd } from './state.js';
import { domainLabel, normalizeDomainId } from './domains.js';
import { ensureProjectsMigrated, projectsInDomain } from './projects.js';
import { ensureGroups, listGroups } from './groups.js';
import { DAY_INTERVALS, intervalForTask, placeInInterval, upcomingWorkDates, weekdayNameFromYmd } from './blocks.js';
import { parentTaskLabel } from './plan.js';
import { comboHTML } from './plan-combo.js';
import { subtasksHTML, drainingHTML } from './plan-subtasks.js';
import { WORKERS } from './agent-core.js';

const cap = w => (w ? w[0].toUpperCase() + w.slice(1) : '');

function scheduleFieldsHTML(t) {
  const today = formatYmd(new Date());
  const dates = upcomingWorkDates();
  if (t.date && t.date >= today && !dates.includes(t.date)) dates.unshift(t.date);
  const selected = dates.includes(t.date) ? t.date : '';
  const shownDay = selected || dates[0] || '';
  const cur = selected ? intervalForTask(t) : '';
  return `<div class="plan-pair">
    <label class="plan-field">Day
      <select id="plan-ymd" onchange="planScheduleChanged('day')">
        ${dates.map(d => `<option value="${d}" ${d === shownDay ? 'selected' : ''}>${cap(weekdayNameFromYmd(d))} ${d.slice(5)}</option>`).join('') || '<option value="">No open work day</option>'}
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

/** Which questions already have an answer (typed, or from the imported plan). Green in the card. */
export function decidedFields(t) {
  return {
    size: !!t.size,
    lno: !!t.lno,
    // Every task gets Personal as a fallback domain, so Personal only counts once it was confirmed.
    domain: !!t.domain && (t.domain !== 'Personal' || !!t.triaged || !!(t.projectId || t.project)),
    project: !!(t.projectId || t.project),
    schedule: !!(t.date && (t.start || t.interval)),
    who: t.assignee === 'person' || t.assignee === 'ai',
    length: t.duration != null && t.duration !== 30,
    blocking: t.blocking === true || t.blocking === false,
    parent: !!t.parentId,
    note: !!String(t.note || '').trim(),
    activity: !!t.activitySource || (!!t.activity && t.activity !== 'act'),
  };
}

const CORE = [['size', 'Size'], ['lno', 'Importance'], ['domain', 'Domain'], ['project', 'Project'], ['schedule', 'Day and time']];

if (typeof window !== 'undefined') {
  // Keep "More details" open across re-renders while you work through it.
  window.planMoreToggle = open => { state.planMoreOpen = !!open; };
}

export function singleCardHTML(t) {
  ensureProjectsMigrated();
  ensureGroups();
  const editing = !!state.planEditId;
  const domain = normalizeDomainId(t.domain) || 'Personal';
  const projects = projectsInDomain(domain);
  const groups = listGroups();
  const pid = t.projectId || t.project || '';
  const set = decidedFields(t);
  const cls = k => `plan-field ${set[k] ? 'is-set' : ''}`;
  const open = CORE.filter(([k]) => !set[k]).map(([, l]) => l);
  const done = CORE.filter(([k]) => set[k]).map(([, l]) => l);
  const moreSet = [
    set.length && `${t.duration} min`, set.blocking && (t.blocking ? 'blocks others' : 'blocks nothing'),
    set.parent && 'subtask', set.activity && t.activity, set.note && 'note', t.draining && 'draining',
  ].filter(Boolean);
  return `<div class="plan-q ${editing ? 'plan-q-edit' : ''}">
    <div class="plan-task-head">
      <p class="plan-task-name">${esc(t.name)}${editing ? ' <span class="plan-edit-badge">editing</span>' : ''}</p>
      <span class="task-del" onclick="deleteTask('${t.id}')" title="Delete" aria-label="Delete">✕</span>
    </div>
    <p class="plan-decided">${open.length
      ? `<span>To decide: <strong>${esc(open.join(', '))}</strong></span>`
      : '<span>Everything is decided.</span>'}${done.length ? ` <span class="plan-decided-done">Already set: ${esc(done.join(', '))}</span>` : ''}</p>

    <div class="plan-row plan-main-row plan-row-2">
      <div class="${cls('size')}">Size
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.size === 'simple' ? 'primary' : ''}" onclick="planPatch({size:'simple'})">Simple</button>
          <button type="button" class="btn ${t.size === 'mid' ? 'primary' : ''}" onclick="planPatch({size:'mid'})">Mid</button>
          <button type="button" class="btn ${t.size === 'complex' ? 'primary' : ''}" onclick="planPatch({size:'complex'})">Complex</button>
        </div>
      </div>
      <div class="${cls('lno')}">Importance
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.lno === 'L' ? 'primary' : ''}" onclick="planPatch({lno:'L'})" title="Big return for the effort: give it your best energy">Leverage</button>
          <button type="button" class="btn ${t.lno === 'N' ? 'primary' : ''}" onclick="planPatch({lno:'N'})" title="Do it well enough">Neutral</button>
          <button type="button" class="btn ${t.lno === 'O' ? 'primary' : ''}" onclick="planPatch({lno:'O'})" title="Keep it small: batch it or hand it off">Optional</button>
        </div>
      </div>
    </div>

    <div class="plan-row plan-row-2">
      <div class="${cls('domain')}">Domain
        ${comboHTML('domain', {
          valueId: set.domain ? domain : '',
          valueLabel: set.domain ? domainLabel(domain) : '',
          placeholder: 'Pick a domain',
        })}
      </div>
      <div class="${cls('project')}">Project
        ${comboHTML('project', {
          valueId: pid,
          valueLabel: projects.find(p => p.id === pid)?.name || '',
          placeholder: 'Pick or type a new project',
        })}
      </div>
    </div>

    <div class="plan-row plan-row-2">
      <div class="${cls('schedule')}">Day and time
        ${scheduleFieldsHTML(t)}
      </div>
      <div class="${cls('who')}">Who does it
        <div class="plan-choices compact">
          ${[['me', 'Me'], ['person', 'Someone else'], ['ai', 'Assistant']].map(([v, l]) =>
            `<button type="button" class="btn ${t.assignee === v ? 'primary' : ''}" onclick="planPatch({assignee:'${v}'})">${l}</button>`
          ).join('')}
        </div>
        ${t.assignee === 'person' ? `<input type="text" placeholder="Their name" value="${esc(t.delegateTo || '')}"
          onchange="planPatch({delegateTo:this.value})" />` : ''}
        ${t.assignee === 'ai' ? `<div class="plan-choices compact">
            ${WORKERS.map(w => `<button type="button" class="btn ${t.agentWorker === w.id ? 'primary' : ''}" title="${esc(w.hint)}"
              onclick="planPatch({agentWorker:'${w.id}'})">${esc(w.label)}</button>`).join('')}
            <label class="errand-day"><input type="checkbox" ${t.agentWithPlan ? 'checked' : ''}
              onchange="planPatch({agentWithPlan:this.checked})" /> Share my open plan with it</label>
          </div>
          <span class="bulk-hint">The note is the brief. The runner on your desktop picks it up within a few minutes; the result shows in Act → Delegated.</span>` : ''}
      </div>
    </div>

    <details class="plan-more" ${state.planMoreOpen ? 'open' : ''} ontoggle="planMoreToggle(this.open)">
      <summary>More details${moreSet.length ? ` <span class="plan-more-set">${esc(moreSet.join(', '))}</span>` : ''}</summary>
      <div class="plan-row plan-main-row ${t.blocking === true ? 'plan-row-3' : 'plan-row-2'}">
        <label class="${cls('length')} plan-length-select">Length
          <select onchange="planPatch({duration:Number(this.value)})">
            ${[15, 30, 60, 180].map(n =>
              `<option value="${n}" ${Number(t.duration) === n ? 'selected' : ''}>${n} min</option>`
            ).join('')}
          </select>
        </label>
        <div class="${cls('blocking')}">Blocks someone else
          <div class="plan-choices compact">
            <button type="button" class="btn ${t.blocking === true ? 'primary' : ''}" onclick="planPatch({blocking:true})">Yes</button>
            <button type="button" class="btn ${t.blocking === false ? 'primary' : ''}" onclick="planPatch({blocking:false})">No</button>
          </div>
        </div>
        ${t.blocking === true ? `
          <label class="plan-field is-set plan-blocking-note">Who or what
            <input type="text" id="plan-blocking-note"
              value="${esc(t.blockingNote || '')}"
              placeholder="Who or what it blocks"
              onchange="planPatch({blockingNote:this.value})" />
          </label>
        ` : ''}
      </div>

      <div class="plan-row plan-row-full">
        <div class="${cls('activity')}">Activity
          <div class="plan-choices compact">
            ${['research', 'communicate', 'act', 'learn'].map(a =>
              `<button type="button" class="btn ${t.activity === a ? 'primary' : ''}" onclick="planSetActivity('${a}')">${a[0].toUpperCase()}${a.slice(1)}</button>`
            ).join('')}
          </div>
        </div>
      </div>

      <div class="plan-row plan-row-full">
        <div class="${cls('parent')}">Part of a bigger task
          ${comboHTML('parent', {
            valueId: t.parentId || '',
            valueLabel: parentTaskLabel(t.parentId),
            placeholder: 'Optional: make it a subtask of…',
          })}
        </div>
      </div>

      <div class="plan-row plan-row-full">
        <div class="${cls('note')} plan-note-col">
          <span>Note</span>
          <textarea id="plan-note" rows="3" placeholder="Optional note" onchange="planPatch({note:this.value})">${esc(t.note || '')}</textarea>
          ${subtasksHTML(t)}
        </div>
      </div>

      <div class="plan-row plan-row-full">
        <div class="plan-field">Batch with similar tasks
          <div class="plan-pair">
            <label class="plan-field">Existing batch
              <select id="plan-group">
                <option value="">None</option>
                ${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
              </select>
            </label>
            <label class="plan-field">Or a new batch
              <input type="text" id="plan-group-name" placeholder="Name, e.g. Calls" />
            </label>
          </div>
        </div>
      </div>

      ${drainingHTML(t)}
    </details>

    <div class="plan-step-actions">
      ${editing ? `
        <button type="button" class="btn primary" onclick="planSaveEdit()">Save</button>
        <button type="button" class="btn" onclick="planStopEdit()">Back to the list</button>
      ` : `
        <button type="button" class="btn primary" onclick="planFinish('auto')" title="Places it at the day and time you picked, or in the batch you picked">Save and next</button>
        <button type="button" class="btn" onclick="planFinish('none')" title="Keeps it without a day">Save without a day</button>
      `}
    </div>
  </div>`;
}
