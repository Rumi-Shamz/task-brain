/** Year → Recurring: appointments and task containers by domain, domain colors, .ics import/export. */
import { state, esc, uid, formatHHMM, parseHHMM, todayYmd, WEEKDAY_SHORT } from './state.js';
import { deps } from './deps.js';
import { dayBlocks, activityRules } from './blocks.js';
import { allDomains, domainColor, domainLabel, domainStyleVar, setDomainColor } from './domains.js';
import { projectsInDomain } from './projects.js';
import { FREQS, describeRepeat, monthlyChoices, normalizeRepeat } from './recurring.js';
import { parseIcs, eventsToSeries, seriesToIcs } from './ics.js';

let openId = null;
let icsMessage = '';

const KIND_LABEL = { event: 'Appointment', leverage: 'Deep-work container (L tasks)', any: 'Container (any task)' };
const FREQ_LABEL = { once: 'Once', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

function rerender() {
  deps.save();
  deps.renderYear();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
}

function seriesRowHTML(b) {
  const time = b.allDay ? 'all day' : `${formatHHMM(b.startMin)}–${formatHHMM(b.endMin)}`;
  const where = b.domain ? domainLabel(b.domain) : 'no domain';
  const open = openId === b.id;
  return `<div class="series-row${open ? ' open' : ''}" style="${domainStyleVar(b.domain)}">
    <button type="button" class="series-summary" onclick="editSeries('${b.id}')" aria-expanded="${open}">
      <span class="series-swatch"></span>
      <span class="series-name">${esc(b.name)}</span>
      <span class="series-meta">${esc(time)} · ${esc(describeRepeat(b))} · ${esc(where)}${b.workDaysOnly ? ' · work days' : ''}${b.location ? ` · ${esc(b.location)}` : ''}</span>
    </button>
    ${open ? seriesFormHTML(b) : ''}
  </div>`;
}

function seriesFormHTML(b) {
  const r = b.repeat;
  const id = b.id;
  const domainOpts = [`<option value="">No domain</option>`]
    .concat(allDomains().map(d => `<option value="${esc(d.id)}" ${b.domain === d.id ? 'selected' : ''}>${esc(d.label)}</option>`)).join('');
  const projects = b.domain ? projectsInDomain(b.domain) : [];
  const projectOpts = [`<option value="">No project</option>`]
    .concat(projects.map(p => `<option value="${esc(p.id)}" ${b.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)).join('');
  const weekdays = WEEKDAY_SHORT.map((label, i) =>
    `<button type="button" class="btn wd-toggle ${b.weekdays.includes(i) ? 'primary' : ''}" onclick="toggleSeriesWeekday('${id}',${i})">${label}</button>`).join('');
  const monthly = r.freq === 'monthly'
    ? `<label>On <select onchange="patchSeries('${id}','monthly',this.value)">
        ${monthlyChoices(r.from).map(c => `<option value="${c.id}" ${r.monthly === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select></label>` : '';
  return `<div class="series-form">
    <label>Name <input type="text" value="${esc(b.name)}" onchange="patchSeries('${id}','name',this.value)" /></label>
    <label>Kind <select onchange="patchSeries('${id}','rule',this.value)">
      ${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${b.rule === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    <label>Domain <select onchange="patchSeries('${id}','domain',this.value)">${domainOpts}</select></label>
    ${b.domain ? `<label>Project <select onchange="patchSeries('${id}','projectId',this.value)">${projectOpts}</select></label>` : ''}
    ${b.rule !== 'event' ? `<label>Stamps activity <select onchange="patchSeries('${id}','activity',this.value)">
      <option value="">None</option>
      ${['research', 'communicate', 'act', 'learn'].map(a => `<option value="${a}" ${b.activity === a ? 'selected' : ''}>${a}</option>`).join('')}
    </select></label>` : ''}
    ${b.rule === 'event' ? `<label class="inline"><input type="checkbox" ${b.allDay ? 'checked' : ''} onchange="patchSeries('${id}','allDay',this.checked)" /> All day</label>` : ''}
    ${b.allDay ? '' : `<label>From <input type="time" value="${formatHHMM(b.startMin)}" onchange="patchSeries('${id}','start',this.value)" /></label>
    <label>To <input type="time" value="${formatHHMM(b.endMin)}" onchange="patchSeries('${id}','end',this.value)" /></label>`}
    <label>Repeats <select onchange="patchSeries('${id}','freq',this.value)">
      ${FREQS.map(f => `<option value="${f}" ${r.freq === f ? 'selected' : ''}>${FREQ_LABEL[f]}</option>`).join('')}
    </select></label>
    ${r.freq !== 'once' ? `<label>Every <input type="number" min="1" max="52" value="${r.interval}" onchange="patchSeries('${id}','interval',this.value)" />
      ${r.freq === 'weekly' ? 'week(s)' : r.freq === 'monthly' ? 'month(s)' : 'year(s)'}</label>` : ''}
    ${r.freq === 'weekly' ? `<div class="wd-row">${weekdays}</div>` : ''}
    <label>${r.freq === 'once' ? 'Date' : 'Starts'} <input type="date" value="${esc(r.from || '')}" onchange="patchSeries('${id}','from',this.value)" /></label>
    ${monthly}
    ${r.freq !== 'once' ? `<label>Ends <input type="date" value="${esc(r.until || '')}" onchange="patchSeries('${id}','until',this.value)" /></label>` : ''}
    <label class="inline"><input type="checkbox" ${b.workDaysOnly ? 'checked' : ''} onchange="patchSeries('${id}','workDaysOnly',this.checked)" /> Only on work / sprint days</label>
    <label class="wide">Location <input type="text" value="${esc(b.location || '')}" onchange="patchSeries('${id}','location',this.value)" /></label>
    <label class="wide">Link <input type="url" placeholder="https://…" value="${esc(b.url || '')}" onchange="patchSeries('${id}','url',this.value)" />
      ${b.url ? `<a href="${esc(b.url)}" target="_blank" rel="noopener">open</a>` : ''}</label>
    <label class="wide">Notes <textarea rows="3" onchange="patchSeries('${id}','note',this.value)">${esc(b.note || '')}</textarea></label>
    <div class="series-actions">
      <button type="button" class="btn" onclick="editSeries('${id}')">Done</button>
      <button type="button" class="btn danger-outline" onclick="removeSeries('${id}')">Delete</button>
    </div>
  </div>`;
}

export function renderRecurringEditor() {
  const el = document.getElementById('year-recurring');
  if (!el) return;
  const blocks = dayBlocks();
  const events = blocks.filter(b => b.rule === 'event');
  const containers = blocks.filter(b => b.rule !== 'event');
  const colors = allDomains().map(d => `<label class="domain-color">
      <input type="color" value="${domainColor(d.id)}" onchange="setDomainColorFromInput('${esc(d.id)}', this.value)" />
      ${esc(d.label)}
    </label>`).join('');
  const rules = activityRules().map(rule => `<li>${esc(rule.kind)} “${esc(rule.value)}” → ${esc(rule.activity)}
    <button type="button" class="btn" onclick="removeActivityRule('${rule.id}')">Remove</button></li>`).join('');
  el.innerHTML = `
    <div class="section-label">Domain colors</div>
    <div class="domain-colors">${colors}</div>
    <div class="section-label">Appointments · fixed time, nothing scheduled inside</div>
    ${events.map(seriesRowHTML).join('') || '<p class="bulk-hint">None yet.</p>'}
    <div class="section-label">Containers · time blocks that tasks are placed into</div>
    ${containers.map(seriesRowHTML).join('') || '<p class="bulk-hint">None yet.</p>'}
    <div class="series-toolbar">
      <button type="button" class="btn primary" onclick="addSeries('event')">Add appointment</button>
      <button type="button" class="btn" onclick="addSeries('any')">Add container</button>
      <label class="btn">Import .ics<input type="file" accept=".ics,text/calendar" hidden onchange="importIcsFile(this)" /></label>
      <select id="ics-domain" title="Domain for imported events">
        <option value="">Imported events: no domain</option>
        ${allDomains().map(d => `<option value="${esc(d.id)}">Imported events → ${esc(d.label)}</option>`).join('')}
      </select>
      <button type="button" class="btn" onclick="exportIcs()">Export .ics</button>
    </div>
    ${icsMessage ? `<p class="bulk-hint">${esc(icsMessage)}</p>` : ''}
    <div class="section-label">Activity rules</div>
    <ul class="plan-batch-list">${rules || '<li>No rules yet. Correct an activity on Plan to save one.</li>'}</ul>`;
}

export function addSeries(kind) {
  const rule = kind === 'event' ? 'event' : kind === 'leverage' ? 'leverage' : 'any';
  const today = todayYmd();
  const wd = (new Date().getDay() + 6) % 7;
  const b = {
    id: uid(),
    name: rule === 'event' ? 'Appointment' : 'Container',
    weekdays: rule === 'event' ? [wd] : [0, 1, 2, 3, 4],
    startMin: rule === 'event' ? 18 * 60 : 15 * 60,
    endMin: rule === 'event' ? 19 * 60 : 16 * 60,
    rule,
    activity: null,
    domain: null,
    projectId: null,
    repeat: normalizeRepeat({ freq: 'weekly', interval: 1, from: today }),
    workDaysOnly: rule !== 'event',
    allDay: false,
  };
  dayBlocks().push(b);
  openId = b.id;
  rerender();
}

export function editSeries(id) {
  openId = openId === id ? null : id;
  deps.renderYear();
}

export function patchSeries(id, field, value) {
  const b = dayBlocks().find(x => x.id === id);
  if (!b) return;
  const r = b.repeat;
  if (field === 'name') b.name = String(value || '').trim().slice(0, 60) || 'Untitled';
  else if (field === 'rule') {
    b.rule = ['event', 'leverage', 'any'].includes(value) ? value : 'any';
    if (b.rule === 'event') b.activity = null;
    else b.allDay = false;
  } else if (field === 'domain') {
    b.domain = value || null;
    b.projectId = null;
  } else if (field === 'projectId') b.projectId = value || null;
  else if (field === 'activity') b.activity = ['research', 'communicate', 'act', 'learn'].includes(value) ? value : null;
  else if (field === 'allDay') {
    b.allDay = !!value;
    if (b.allDay) { b.startMin = 0; b.endMin = 24 * 60; } else { b.startMin = 9 * 60; b.endMin = 10 * 60; }
  } else if (field === 'start' || field === 'end') {
    const mins = parseHHMM(value);
    if (mins == null) return;
    if (field === 'start') {
      const len = b.endMin - b.startMin;
      b.startMin = mins;
      if (b.endMin <= mins) b.endMin = Math.min(24 * 60, mins + Math.max(15, len));
    } else if (mins > b.startMin) b.endMin = mins;
  } else if (field === 'freq') {
    r.freq = FREQS.includes(value) ? value : 'weekly';
    if (r.freq !== 'weekly' && !r.from) r.from = todayYmd();
    if (r.freq === 'monthly' && !r.monthly) r.monthly = 'day';
  } else if (field === 'interval') r.interval = Math.max(1, Math.min(52, Math.round(Number(value)) || 1));
  else if (field === 'from') {
    r.from = value || null;
    // A one-off or a weekly series started on a new day lands on that weekday.
    if (value && (r.freq === 'once' || b.weekdays.length <= 1)) b.weekdays = [((new Date(`${value}T12:00:00`).getDay()) + 6) % 7];
  } else if (field === 'until') r.until = value || null;
  else if (field === 'monthly') r.monthly = ['day', 'nth', 'last'].includes(value) ? value : 'day';
  else if (field === 'workDaysOnly') b.workDaysOnly = !!value;
  else if (field === 'note') b.note = String(value || '').slice(0, 2000);
  else if (field === 'location') b.location = String(value || '').trim().slice(0, 200);
  else if (field === 'url') b.url = /^https?:\/\//i.test(String(value || '').trim()) ? String(value).trim() : '';
  b.repeat = normalizeRepeat(r);
  rerender();
}

export function toggleSeriesWeekday(id, wd) {
  const b = dayBlocks().find(x => x.id === id);
  if (!b) return;
  const has = b.weekdays.includes(wd);
  if (has && b.weekdays.length === 1) return;
  b.weekdays = has ? b.weekdays.filter(d => d !== wd) : [...b.weekdays, wd].sort((a, c) => a - c);
  rerender();
}

export function removeSeries(id) {
  const b = dayBlocks().find(x => x.id === id);
  if (!b || !confirm(`Delete “${b.name}” and all its occurrences?`)) return;
  state.yearRhythm.dayBlocks = dayBlocks().filter(x => x.id !== id);
  state.blockSkips = (state.blockSkips || []).filter(s => s.blockId !== id);
  if (openId === id) openId = null;
  rerender();
}

export function setDomainColorFromInput(domainId, color) {
  setDomainColor(domainId, color);
  rerender();
}

/** Add or update series from an .ics file (matched by the event UID, so re-importing does not duplicate). */
export function importIcsText(text, domain) {
  const { series, skipped } = eventsToSeries(parseIcs(text), { todayYmd: todayYmd(), domain: domain || null });
  const blocks = dayBlocks();
  if (!Array.isArray(state.blockSkips)) state.blockSkips = [];
  let added = 0, updated = 0;
  series.forEach(s => {
    const { exdates, ...fields } = s;
    let b = s.icsUid ? blocks.find(x => x.icsUid === s.icsUid) : null;
    if (b) { Object.assign(b, fields, { id: b.id, domain: b.domain || fields.domain }); updated++; }
    else { b = { id: uid(), ...fields }; blocks.push(b); added++; }
    exdates.forEach(date => {
      if (!state.blockSkips.some(k => k.date === date && k.blockId === b.id)) state.blockSkips.push({ date, blockId: b.id });
    });
  });
  const skippedText = Object.entries(skipped).map(([why, n]) => `${n} ${why}`).join(', ');
  icsMessage = `Imported ${added} new, updated ${updated}.${skippedText ? ` Skipped: ${skippedText}.` : ''}`;
  return { added, updated, skipped };
}

export function importIcsFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const domain = document.getElementById('ics-domain')?.value || null;
  const reader = new FileReader();
  reader.onload = () => {
    try { importIcsText(String(reader.result || ''), domain); }
    catch (e) { console.error(e); icsMessage = 'Could not read that .ics file: ' + (e.message || e); }
    rerender();
  };
  reader.readAsText(file);
  input.value = '';
}

export function exportIcs() {
  const text = seriesToIcs(dayBlocks(), { skips: state.blockSkips || [], domainLabel, stampYmd: todayYmd() });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'task-brain-recurring.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
