/** Plan card markup for one task, and committing its Day / When choice. */
import { state, esc, formatYmd } from './state.js';
import { domainLabel, normalizeDomainId, domainDotHTML } from './domains.js';
import { ensureProjectsMigrated, projectsInDomain } from './projects.js';
import { ensureGroups, listGroups } from './groups.js';
import { DAY_INTERVALS, intervalForTask, placeInInterval, upcomingWorkDates, weekdayNameFromYmd } from './blocks.js';
import { parentTaskLabel, planPatch } from './plan.js';
import { act, actOn } from './actions.js';
import { comboHTML } from './plan-combo.js';
import { subtasksHTML, drainingHTML } from './plan-subtasks.js';
import { WORKERS } from './agent-core.js';
import { recoveryFor, recoveryText } from './recovery.js';

/** Length choices; a length set elsewhere (drag-resize, import) stays selectable instead of showing as 15 min. */
const LENGTHS = [15, 30, 45, 60, 90, 120, 180];
const lengthOptions = d => {
  const n = Number(d);
  return n > 0 && !LENGTHS.includes(n) ? [...LENGTHS, n].sort((a, b) => a - b) : LENGTHS;
};

const cap = w => (w ? w[0].toUpperCase() + w.slice(1) : '');

function scheduleFieldsHTML(t) {
  const today = formatYmd(new Date());
  const dates = upcomingWorkDates();
  if (t.date && t.date >= today && !dates.includes(t.date)) dates.unshift(t.date);
  const selected = dates.includes(t.date) ? t.date : '';
  const shownDay = selected || dates[0] || '';
  const cur = selected ? intervalForTask(t) : '';
  const cls = `plan-field ${decidedFields(t).schedule ? 'is-set' : ''}`;
  return `<label class="${cls}"><span class="plan-label">Day</span>
      <select id="plan-ymd" ${actOn('change', 'planScheduleChanged', 'day')}>
        ${dates.map(d => `<option value="${d}" ${d === shownDay ? 'selected' : ''}>${cap(weekdayNameFromYmd(d))} ${d.slice(5)}</option>`).join('') || '<option value="">No open work day</option>'}
      </select>
    </label>
    <label class="${cls}"><span class="plan-label">When</span>
      <select id="plan-interval" ${actOn('change', 'planScheduleChanged')}>
        <option value="" ${!cur ? 'selected' : ''}>Leave open</option>
        ${DAY_INTERVALS.map(i => `<option value="${i.id}" title="${esc(i.focus)}" ${i.id === cur ? 'selected' : ''}>${esc(i.label)} · ${esc(i.focus)}</option>`).join('')}
      </select>
    </label>`;
}

/** Everyone you delegated to before, for the name field's suggestions. */
function delegateNamesHTML() {
  const names = [...new Set(state.tasks.map(x => String(x.delegateTo || '').trim()).filter(Boolean))].sort();
  return names.map(n => `<option value="${esc(n)}"></option>`).join('');
}

/** Who does it: three choices; Delegate and Assistant swap them for their own controls (× goes back). */
function whoHTML(t) {
  const back = `<button type="button" class="plan-x" ${act('planPatch', {assignee:'me'})} title="Back to: I do it myself" aria-label="Do it myself">×</button>`;
  if (t.assignee === 'person') {
    return `<div class="plan-inline">
      <input type="text" id="plan-delegate-to" list="plan-delegate-names" autocomplete="off" placeholder="Who"
        value="${esc(t.delegateTo || '')}" ${actOn('change', 'planPatch', {delegateTo:'$value'})} />
      <datalist id="plan-delegate-names">${delegateNamesHTML()}</datalist>
      <select aria-label="How" ${actOn('change', 'planDelegateVia', '$value')}>
        <option value="" ${!t.delegateVia ? 'selected' : ''}>How?</option>
        ${[['call', 'Call'], ['message', 'Message'], ['email', 'Email']].map(([v, l]) =>
          `<option value="${v}" ${t.delegateVia === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${back}
    </div>`;
  }
  if (t.assignee === 'ai') {
    return `<div class="plan-inline">
      <div class="plan-choices compact">
        ${WORKERS.map(w => `<button type="button" class="btn ${t.agentWorker === w.id ? 'primary' : ''}" title="${esc(w.hint)}"
          ${act('planPatch', {agentWorker:w.id})}>${esc(w.label)}</button>`).join('')}
      </div>
      <label class="plan-check" title="The note is the brief. The runner on your desktop picks it up within a few minutes; the result shows in Act → Needs you.">
        <input type="checkbox" ${t.agentWithPlan ? 'checked' : ''} ${actOn('change', 'planPatch', {agentWithPlan:'$checked'})} /> Share my plan</label>
      ${back}
    </div>`;
  }
  return `<div class="plan-choices compact">
    ${[['me', 'Me'], ['person', 'Delegate'], ['ai', 'Assistant']].map(([v, l]) =>
      `<button type="button" class="btn ${t.assignee === v ? 'primary' : ''}" ${act('planPickAssignee', v)}>${l}</button>`
    ).join('')}
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

const CORE = [['lno', 'Importance'], ['size', 'Size'], ['schedule', 'Day and time']];

// Keep the collapsible parts as you left them across re-renders while you work through the list.
export function planMoreToggle(open) { state.planMoreOpen = !!open; }
export function planStartBlocking() {
  planPatch({ blocking: true });
  setTimeout(() => document.getElementById('plan-blocking-note')?.focus(), 0);
}
/** "How?" select: an empty choice clears the way. */
export function planDelegateVia(value) { planPatch({ delegateVia: value || null }); }
/** Me / Delegate / Assistant; the two that take more input then focus the who field. */
export function planPickAssignee(v) {
  planPatch({ assignee: v });
  if (v !== 'me') setTimeout(() => document.getElementById('plan-delegate-to')?.focus(), 0);
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
  const moreSet = [
    set.domain ? domainLabel(domain) : 'no domain yet', set.project && projects.find(p => p.id === pid)?.name,
    set.activity && cap(t.activity), set.parent && 'subtask of a bigger task', t.draining && 'draining',
  ].filter(Boolean);
const label = text => `<span class="plan-label">${text}</span>`;
  return `<div class="plan-q ${editing ? 'plan-q-edit' : ''}">
    <div class="plan-task-head">
      <p class="plan-task-name">${set.domain ? domainDotHTML(domain) : ''}${esc(t.name)}${editing ? ' <span class="plan-edit-badge">editing</span>' : ''}</p>
      <span class="task-del" ${act('deleteTask', t.id)} title="Delete" aria-label="Delete">✕</span>
    </div>
    <p class="plan-decided">${open.length
      ? `<span>To decide: <strong>${esc(open.join(', '))}</strong></span>`
      : '<span>Everything is decided.</span>'}${done.length ? ` <span class="plan-decided-done">Already set: ${esc(done.join(', '))}</span>` : ''}</p>

    <div class="plan-row plan-main-row">
      <div class="${cls('lno')}">${label('Importance')}
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.lno === 'L' ? 'primary' : ''}" ${act('planPatch', {lno:'L'})} title="Big return for the effort: give it your best energy">Leverage</button>
          <button type="button" class="btn ${t.lno === 'N' ? 'primary' : ''}" ${act('planPatch', {lno:'N'})} title="Do it well enough">Neutral</button>
          <button type="button" class="btn ${t.lno === 'O' ? 'primary' : ''}" ${act('planPatch', {lno:'O'})} title="Keep it small: batch it or hand it off">Optional</button>
        </div>
      </div>
      <div class="${cls('blocking')} plan-blocking ${t.blocking === true ? 'is-blocking' : ''}">${label('Blocking')}
        ${t.blocking === true ? `<div class="plan-block-search">
            <input type="text" id="plan-blocking-note" list="plan-blocking-options" autocomplete="off"
              value="${esc(t.blockingNote || '')}" placeholder="Search tasks, projects, objectives"
              ${actOn('change', 'planPatch', {blockingNote:'$value'})} />
            <datalist id="plan-blocking-options">${blockingOptionsHTML(t)}</datalist>
            <button type="button" class="plan-x" ${act('planPatch', {blocking:false})} title="Not blocking anything" aria-label="Cancel blocking">×</button>
          </div>` : `<div class="plan-choices compact">
            <button type="button" class="btn" ${act('planStartBlocking')} title="Pick what it blocks">Yes</button>
            <button type="button" class="btn ${t.blocking === false ? 'primary' : ''}" ${act('planPatch', {blocking:false})}>No</button>
          </div>`}
      </div>
      <div class="${cls('size')}">${label('Size')}
        <div class="plan-choices compact">
          <button type="button" class="btn ${t.size === 'simple' ? 'primary' : ''}" ${act('planPatch', {size:'simple'})}>Simple</button>
          <button type="button" class="btn ${t.size === 'mid' ? 'primary' : ''}" ${act('planPatch', {size:'mid'})}>Mid</button>
          <button type="button" class="btn ${t.size === 'complex' ? 'primary' : ''}" ${act('planPatch', {size:'complex'})}>Complex</button>
        </div>
      </div>
      <label class="${cls('length')} plan-length-select">${label('Length')}
        <select ${actOn('change', 'planPatch', {duration:'$number'})}>
          ${lengthOptions(t.duration).map(n =>
            `<option value="${n}" ${Number(t.duration) === n ? 'selected' : ''}>${n} min</option>`
          ).join('')}
        </select>
      </label>
      ${recoveryFor(t) ? `<span class="plan-recovery" title="Suggested on the day calendar right after the task">${esc(recoveryText(recoveryFor(t)))}</span>` : ''}
    </div>

    <div class="plan-row plan-when-row">
      ${scheduleFieldsHTML(t)}
      <div class="${cls('who')} plan-who">${label(t.assignee === 'person' ? 'Delegate to' : t.assignee === 'ai' ? 'Assistant' : 'Who does it')}
        ${whoHTML(t)}
      </div>
    </div>

    <div class="plan-row plan-row-full">
      <label class="${cls('note')} plan-note-col">${label('Note')}
        <textarea id="plan-note" rows="2" placeholder="Optional note" ${actOn('change', 'planPatch', {note:'$value'})}>${esc(t.note || '')}</textarea>
      </label>
    </div>

    ${subtasksHTML(t) ? `<div class="plan-row plan-row-full">${subtasksHTML(t)}</div>` : ''}

    <details class="plan-more" ${state.planMoreOpen ? 'open' : ''} ${actOn('toggle', 'planMoreToggle', '$open')}>
      <summary>More${moreSet.length ? ` <span class="plan-more-set">${esc(moreSet.join(' · '))}</span>` : ''}</summary>
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
      <div class="plan-row plan-row-full">
        <div class="${cls('activity')}">${label('Activity')}
          <div class="plan-choices compact">
            ${['research', 'communicate', 'act', 'learn'].map(a =>
              `<button type="button" class="btn ${t.activity === a ? 'primary' : ''}" ${act('planSetActivity', a)}>${a[0].toUpperCase()}${a.slice(1)}</button>`
            ).join('')}
          </div>
        </div>
      </div>

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
        <button type="button" class="btn primary" ${act('planSaveEdit')}>Save</button>
        <button type="button" class="btn" ${act('planStopEdit')}>Back to the list</button>
      ` : `
        <button type="button" class="btn primary" ${act('planFinish', 'auto')} title="Places it at the day and time you picked, or in the batch you picked">Save and next</button>
        <button type="button" class="btn" ${act('planFinish', 'none')} title="Keeps it without a day">Save without a day</button>
      `}
    </div>
  </div>`;
}
