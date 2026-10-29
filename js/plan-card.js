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

const CORE = [['lno', 'Importance'], ['size', 'Size'], ['schedule', 'Day and time'], ['domain', 'Domain'], ['project', 'Project']];

if (typeof window !== 'undefined') {
  // Keep the collapsible parts as you left them across re-renders while you work through the list.
  window.planMoreToggle = open => { state.planMoreOpen = !!open; };
  window.planWhereToggle = open => { state.planWhereOpen = !!open; };
  window.planStartBlocking = () => {
    window.planPatch({ blocking: true });
    setTimeout(() => document.getElementById('plan-blocking-note')?.focus(), 0);
  };
}

/** What a task can block: other open tasks, projects, and project objectives (searchable list). */
function blockingOptionsHTML(t) {
  const seen = new Set();
  const opts = [];
  const add = (value, kind) => {
    const v = String(value || '').trim();
    if (!v || seen.has(v.toLowerCase())) return;
    seen.add(v.toLowerCase());
    opts.push(`<option value="${esc(v)}">${esc(kind)}</option>`);
  };
  (state.projects || []).filter(p => p.status !== 'archived' && !/^unassigned$/i.test(p.name || '')).forEach(p => {
    add(p.name, 'Project');
    add(p.objective, `Objective · ${p.name}`);
  });
  state.tasks.filter(x => x.id !== t.id && !x.done).slice(0, 300).forEach(x => add(x.name, 'Task'));
  return opts.join('');
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
  const moreSet = [set.parent && 'subtask of a bigger task', t.draining && 'draining'].filter(Boolean);
  const label = text => `<span class="plan-label">${text}</span>`;
  const where = [set.domain && domainLabel(domain), set.project && projects.find(p => p.id === pid)?.name].filter(Boolean);
  const whereOpen = state.planWhereOpen ?? !(set.domain && set.project);
  return `<div class="plan-q ${editing ? 'plan-q-edit' : ''}">
    <div class="plan-task-head">
      <p class="plan-task-name">${esc(t.name)}${editing ? ' <span class="plan-edit-badge">editing</span>' : ''}</p>
      <span class="task-del" onclick="deleteTask('${t.id}')" title="Delete" aria-label="Delete">✕</span>
    </div>
    <p class="plan-decided">${open.length
      ? `<span>To decide: <strong>${esc(open.join(', '))}</strong></span>`
      : '<span>Everything is decided.</span>'}${done.length ? ` <span class="plan-decided-done">Already set: ${esc(done.join(', '))}</span>` : ''}</p>

    <div class="plan-row plan-main-row">
      <div class="${cls('lno')}">${label('Importance')}
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.lno === 'L' ? 'primary' : ''}" onclick="planPatch({lno:'L'})" title="Big return for the effort: give it your best energy">Leverage</button>
          <button type="button" class="btn ${t.lno === 'N' ? 'primary' : ''}" onclick="planPatch({lno:'N'})" title="Do it well enough">Neutral</button>
          <button type="button" class="btn ${t.lno === 'O' ? 'primary' : ''}" onclick="planPatch({lno:'O'})" title="Keep it small: batch it or hand it off">Optional</button>
        </div>
      </div>
      <div class="${cls('blocking')} plan-blocking ${t.blocking === true ? 'is-blocking' : ''}">${label('Blocking')}
        ${t.blocking === true ? `<div class="plan-block-search">
            <input type="text" id="plan-blocking-note" list="plan-blocking-options" autocomplete="off"
              value="${esc(t.blockingNote || '')}" placeholder="Search tasks, projects, objectives"
              onchange="planPatch({blockingNote:this.value})" />
            <datalist id="plan-blocking-options">${blockingOptionsHTML(t)}</datalist>
            <button type="button" class="plan-x" onclick="planPatch({blocking:false})" title="Not blocking anything" aria-label="Cancel blocking">×</button>
          </div>` : `<div class="plan-choices compact">
            <button type="button" class="btn" onclick="planStartBlocking()" title="Pick what it blocks">Yes</button>
            <button type="button" class="btn ${t.blocking === false ? 'primary' : ''}" onclick="planPatch({blocking:false})">No</button>
          </div>`}
      </div>
      <div class="${cls('size')}">${label('Size')}
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.size === 'simple' ? 'primary' : ''}" onclick="planPatch({size:'simple'})">Simple</button>
          <button type="button" class="btn ${t.size === 'mid' ? 'primary' : ''}" onclick="planPatch({size:'mid'})">Mid</button>
          <button type="button" class="btn ${t.size === 'complex' ? 'primary' : ''}" onclick="planPatch({size:'complex'})">Complex</button>
        </div>
      </div>
      <label class="${cls('length')} plan-length-select">${label('Length')}
        <select onchange="planPatch({duration:Number(this.value)})">
          ${[15, 30, 60, 180].map(n =>
            `<option value="${n}" ${Number(t.duration) === n ? 'selected' : ''}>${n} min</option>`
          ).join('')}
        </select>
      </label>
    </div>

    <div class="plan-row plan-row-2">
      <div class="${cls('schedule')}">${label('Day and time')}
        ${scheduleFieldsHTML(t)}
      </div>
      <div class="${cls('who')}">${label('Who does it')}
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

    <details class="plan-more plan-where" ${whereOpen ? 'open' : ''} ontoggle="planWhereToggle(this.open)">
      <summary>Domain and project <span class="plan-more-set">${where.length ? esc(where.join(' · ')) : 'to decide'}</span></summary>
      <div class="plan-row plan-row-2">
        <div class="${cls('domain')}">${label('Domain')}
          ${comboHTML('domain', {
            valueId: set.domain ? domain : '',
            valueLabel: set.domain ? domainLabel(domain) : '',
            placeholder: 'Pick a domain',
          })}
        </div>
        <div class="${cls('project')}">${label('Project')}
          ${comboHTML('project', {
            valueId: pid,
            valueLabel: projects.find(p => p.id === pid)?.name || '',
            placeholder: 'Pick or type a new project',
          })}
        </div>
      </div>
    </details>

    <div class="plan-row plan-row-full">
      <label class="${cls('note')} plan-note-col">${label('Note')}
        <textarea id="plan-note" rows="2" placeholder="Optional note" onchange="planPatch({note:this.value})">${esc(t.note || '')}</textarea>
      </label>
    </div>

    ${subtasksHTML(t) ? `<div class="plan-row plan-row-full">${subtasksHTML(t)}</div>` : ''}

    <div class="plan-row plan-row-full">
      <div class="${cls('activity')}">${label('Activity')}
        <div class="plan-choices compact">
          ${['research', 'communicate', 'act', 'learn'].map(a =>
            `<button type="button" class="btn ${t.activity === a ? 'primary' : ''}" onclick="planSetActivity('${a}')">${a[0].toUpperCase()}${a.slice(1)}</button>`
          ).join('')}
        </div>
      </div>
    </div>

    <details class="plan-more" ${state.planMoreOpen ? 'open' : ''} ontoggle="planMoreToggle(this.open)">
      <summary>More${moreSet.length ? ` <span class="plan-more-set">${esc(moreSet.join(', '))}</span>` : ''}</summary>
      <div class="plan-row plan-row-full">
        <div class="${cls('parent')}">${label('Part of a bigger task')}
          ${comboHTML('parent', {
            valueId: t.parentId || '',
            valueLabel: parentTaskLabel(t.parentId),
            placeholder: 'Optional: make it a subtask of…',
          })}
        </div>
      </div>

      <div class="plan-row plan-row-full">
        <div class="plan-field"><span class="plan-label">Batch with similar tasks</span>
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
