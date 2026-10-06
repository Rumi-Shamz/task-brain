/**
 * Validating week-plan import (JSON preferred, CSV legacy).
 * Schema source of truth: schema/plan.schema.json
 */
import {
  state, DEFAULT_DURATION,
  newTask, mondayOnOrBefore, addDaysLocal, formatYmd, formatHHMM, parseYmd, esc, uid,
} from './state.js';
import { normalizeDomainId, domainLabel, DOMAINS as DOMAIN_LIST } from './domains.js';
import { ensureProjectForDomain, ensureProjectsMigrated } from './projects.js';
import { deps } from './deps.js';

export const DOMAINS = DOMAIN_LIST.map(d => d.id);
export const LENGTHS = [15, 30, 60, 180];
export const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };
export const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

/** CSV Domain cell → { domain, project hint } — project names stay separate. */
const DOMAIN_CELL_HINTS = {
  alfa: { domain: 'ALFA', project: null },
  dorst: { domain: 'Dorst', project: null },
  personal: { domain: 'Personal', project: null },
  other: { domain: 'Personal', project: null },
  softwaredev: { domain: 'Dev', project: null },
  'software dev': { domain: 'Dev', project: null },
  dev: { domain: 'Dev', project: null },
  swingshuffle: { domain: 'SwingShuffle', project: null },
  'swing&shuffle': { domain: 'SwingShuffle', project: null },
  'swing & shuffle': { domain: 'SwingShuffle', project: null },
  swingsociety: { domain: 'SwingSociety', project: null },
  'swing society': { domain: 'SwingSociety', project: null },
  swingbuzz: { domain: 'SwingSociety', project: 'Swing Buzz' },
  'swing buzz': { domain: 'SwingSociety', project: 'Swing Buzz' },
};

export function resolveDomainProject(rawDomain) {
  const raw = String(rawDomain || '').trim();
  if (!raw) return { domain: null, project: null, warnings: ['missing domain'] };
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  if (DOMAIN_CELL_HINTS[key]) {
    return { ...DOMAIN_CELL_HINTS[key], warnings: [] };
  }
  const id = normalizeDomainId(raw);
  if (id) return { domain: id, project: null, warnings: [] };
  // Unknown string used as project name under Personal
  return { domain: 'Personal', project: raw, warnings: [`unknown domain "${raw}" → Personal project`] };
}

export function ensureProjectRecord(domain, projectLabel) {
  return ensureProjectForDomain(domain, projectLabel);
}

/** Monday of the week being planned: this week Mon–Thu, next week from Friday on (weekend planning). */
export function defaultImportMonday(now = new Date()) {
  const wd = (now.getDay() + 6) % 7;
  const mon = mondayOnOrBefore(now);
  return wd >= 4 ? addDaysLocal(mon, 7) : mon;
}

/** The "Week of" picker next to Import week plan; falls back to defaultImportMonday(). */
export function weekMondayForImport() {
  const picked = parseYmd(document.getElementById('week-plan-week')?.value || '');
  return picked ? mondayOnOrBefore(picked) : defaultImportMonday();
}

/** Domain written in a task name ("Swing Buzz: Bus rental", "ALFA plan preparation"), longest match first. */
export function domainFromName(name) {
  const text = ' ' + String(name || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ') + ' ';
  const keys = Object.keys(DOMAIN_CELL_HINTS).filter(k => k !== 'other' && k !== 'personal' && k !== 'dev')
    .sort((a, b) => b.length - a.length);
  const hit = keys.find(k => text.includes(' ' + k.replace(/[^a-z0-9&]+/g, ' ').trim() + ' '));
  return hit ? DOMAIN_CELL_HINTS[hit] : null;
}

function snapLength(n) {
  const v = Math.round(Number(n));
  if (LENGTHS.includes(v)) return { value: v, warning: null };
  if (!Number.isFinite(v) || v <= 0) return { value: DEFAULT_DURATION, warning: `length missing/invalid → ${DEFAULT_DURATION}` };
  // nearest allowed
  let best = LENGTHS[0];
  let bestD = Math.abs(v - best);
  for (const L of LENGTHS) {
    const d = Math.abs(v - L);
    if (d < bestD) { best = L; bestD = d; }
  }
  return { value: best, warning: `length ${v} snapped to ${best}` };
}

function normalizePriority(raw) {
  if (raw === '' || raw == null) return { value: 0, warning: 'priority missing → 0' };
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return { value: 0, error: `priority not a number: ${raw}` };
  if (n < 0 || n > 3) return { value: Math.max(0, Math.min(3, n)), warning: `priority ${n} clamped to 0–3` };
  return { value: n, warning: null };
}

function normalizePressure(raw) {
  const p = String(raw || '').trim().toLowerCase();
  if (!p || /✕|✗|×/.test(p)) return { value: null, warning: null };
  if (p === 'urgent' || p === 'important') return { value: p, warning: null };
  return { value: null, error: `timepressure must be urgent|important, got "${raw}"` };
}

/** Fields compared against the imported copy: a difference means the import needed a hand fix. */
export const IMPORT_FIELDS = ['name', 'domain', 'projectId', 'activity', 'duration', 'lno', 'assignee'];

/**
 * @param {{ monday?: Date, source?: string }} [opts] monday defaults to the selected Year week
 * @returns {{ tasks: object[], rows: {row:number, level:string, message:string}[] }}
 */
export function validateAndBuildItems(items, opts = {}) {
  const reports = [];
  const tasks = [];
  const nextFree = {};
  const mon = opts.monday || weekMondayForImport();

  items.forEach((item, i) => {
    const row = item._row != null ? item._row : i + 1;
    const warnings = [];
    const nameRaw = String(item.name || '').trim();
    if (!nameRaw) {
      reports.push({ row, level: 'error', message: 'empty name — skipped' });
      return;
    }
    let status = item.status || 'todo';
    let name = nameRaw;
    if (/✕|✗|×/.test(name)) {
      status = 'done';
      name = name.replace(/\s*[✕✗×]\s*$/u, '').trim();
    }
    if (/^dump$/i.test(name)) {
      status = 'someday';
    }
    let dom = resolveDomainProject(item.domain || item.projectDomain);
    if (!dom.domain && domainFromName(name)) {
      dom = { ...domainFromName(name), warnings: [] };
      reports.push({ row, level: 'info', message: `domain read from name → ${domainLabel(dom.domain)}${dom.project ? ' / ' + dom.project : ''} ("${name}")` });
    }
    warnings.push(...(dom.warnings || []));
    if (!dom.domain) {
      // Missing domain → Personal / Unassigned — never invent a project from the task name.
      dom = { domain: 'Personal', project: 'Unassigned', warnings: [] };
      const dup = warnings.indexOf('missing domain');
      if (dup >= 0) warnings.splice(dup, 1);
      warnings.push('missing domain → Personal / Unassigned');
    }
    const projectLabel = item.project || dom.project || domainLabel(dom.domain);
    const projectId = ensureProjectRecord(dom.domain, projectLabel);

    // Finished items only need a name and a domain; missing planning fields are not worth a warning.
    const done = status === 'done';
    const pr = normalizePriority(item.priority);
    if (pr.error) { reports.push({ row, level: 'error', message: pr.error + ` ("${name}")` }); return; }
    if (pr.warning && !done) warnings.push(pr.warning);

    const tp = normalizePressure(item.timepressure);
    if (tp.error) { reports.push({ row, level: 'error', message: tp.error + ` ("${name}")` }); return; }

    const len = snapLength(item.length);
    if (len.warning && !done) warnings.push(len.warning);

    const slotKey = String(item.slot || '').trim().toLowerCase();
    const dayKey = String(item.weekday || '').trim().toLowerCase();
    let start = null;
    let date = null;
    if (slotKey || dayKey) {
      if (DAY_OFFSET[dayKey] == null) {
        reports.push({ row, level: 'error', message: `bad weekday "${item.weekday}" ("${name}")` });
        return;
      }
      if (SLOT_START[slotKey] == null) {
        reports.push({ row, level: 'error', message: `bad slot "${item.slot}" ("${name}")` });
        return;
      }
      const dayDate = addDaysLocal(mon, DAY_OFFSET[dayKey]);
      date = formatYmd(dayDate);
      const stackKey = date + '|' + slotKey;
      const preferred = SLOT_START[slotKey];
      const placed = nextFree[stackKey] != null ? nextFree[stackKey] : preferred;
      start = formatHHMM(placed);
      nextFree[stackKey] = placed + len.value;
    }

    let reviewAt = item.reviewAt || null;
    if (status === 'someday' && !reviewAt) {
      reviewAt = formatYmd(addDaysLocal(mon, 7));
      reports.push({ row, level: 'info', message: `someday review set to ${reviewAt} ("${name}")` });
    }

    let size = null;
    if (pr.value >= 3) size = 'complex';
    else if (pr.value >= 2) size = 'mid';
    else if (pr.value >= 1) size = 'simple';

    const activity = item.activity && ['research', 'communicate', 'act', 'learn'].includes(item.activity)
      ? item.activity
      : 'act';
    const task = newTask(name, {
      project: projectId,
      projectId,
      domain: dom.domain,
      lane: activity,
      activity,
      date,
      start,
      duration: len.value,
      done: status === 'done',
      status,
      reviewAt,
      reviewSkips: 0,
      blocking: tp.value === 'urgent' ? true : null,
      note: String(item.description || '').trim(),
      size,
      priority: pr.value,
      timepressure: tp.value,
      lno: ['L', 'N', 'O'].includes(item.lno) ? item.lno : null,
      assignee: item.assignee,
      delegateTo: String(item.delegateTo || '').trim(),
    });
    task.imported = { from: opts.source || formatYmd(mon) };
    IMPORT_FIELDS.forEach(f => { task.imported[f] = task[f] ?? null; });
    tasks.push(task);
    warnings.forEach(w => reports.push({ row, level: 'warn', message: `${w} ("${name}")` }));
  });

  return { tasks, rows: reports };
}

export function csvRowsToItems(rows) {
  if (!rows || !rows.length) return [];
  const header = rows[0].map(h => String(h || '').trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = {
    key: idx(['key word', 'keyword', 'task', 'title', 'name']),
    domain: idx(['domain']),
    project: idx(['project', 'project name', 'project title']),
    priority: idx(['priority']),
    pressure: idx(['timepressure', 'time pressure']),
    slot: idx(['allotted time', 'slot', 'time of day']),
    day: idx(['allotted day', 'day', 'weekday']),
    length: idx(['length', 'duration', 'minutes']),
    sessions: idx(['sessions']),
    desc: idx(['description', 'notes', 'details']),
  };
  // Legacy CSVs sometimes label the domain column "project"
  if (col.domain < 0 && col.project >= 0) {
    col.domain = col.project;
    col.project = -1;
  }
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[col.key] || '').trim();
    if (!name) continue;
    items.push({
      _row: r + 1,
      name,
      domain: col.domain >= 0 ? row[col.domain] : '',
      project: col.project >= 0 ? row[col.project] : '',
      priority: col.priority >= 0 ? row[col.priority] : '',
      timepressure: col.pressure >= 0 ? row[col.pressure] : '',
      slot: col.slot >= 0 ? row[col.slot] : '',
      weekday: col.day >= 0 ? row[col.day] : '',
      length: col.length >= 0 ? row[col.length] : '',
      sessions: col.sessions >= 0 ? row[col.sessions] : 1,
      description: col.desc >= 0 ? row[col.desc] : '',
    });
  }
  return items;
}

export function parseCsvText(text) {
  const rows = [];
  let row = [], cell = '', i = 0, q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Warnings grouped by kind ("priority missing → 0 · 5 tasks"), each expandable to its rows. */
function groupReports(reports) {
  const groups = new Map();
  reports.forEach(r => {
    const m = /^(.*?) \("(.*)"\)$/.exec(r.message);
    const kind = m ? m[1] : r.message;
    if (!groups.has(kind)) groups.set(kind, { kind, level: r.level, rows: [] });
    groups.get(kind).rows.push({ row: r.row, name: m ? m[2] : '' });
  });
  return [...groups.values()];
}

function showImportReport(msgEl, added, reports, monday) {
  const errors = reports.filter(r => r.level === 'error');
  const warns = reports.filter(r => r.level === 'warn');
  const infos = reports.filter(r => r.level === 'info');
  const summary = [
    `Imported ${added} task${added === 1 ? '' : 's'} for the week of ${formatYmd(monday || weekMondayForImport())}.`,
    errors.length ? `${errors.length} row${errors.length === 1 ? '' : 's'} skipped.` : '',
    warns.length ? `${warns.length} warning${warns.length === 1 ? '' : 's'}.` : '',
    infos.length ? `${infos.length} filled in automatically.` : '',
  ].filter(Boolean).join(' ');
  if (msgEl) {
    msgEl.textContent = summary;
    msgEl.style.whiteSpace = 'normal';
    msgEl.classList.toggle('err', errors.length > 0);
  }
  const box = document.getElementById('week-plan-report');
  if (!box) return;
  const section = (level, title) => {
    const groups = groupReports(reports.filter(r => r.level === level));
    if (!groups.length) return '';
    return `<div class="import-group ${level}"><div class="section-label">${title}</div>${groups.map(g => `
      <details ${level === 'error' ? 'open' : ''}><summary>${escapeHtml(g.kind)} · ${g.rows.length} task${g.rows.length === 1 ? '' : 's'}</summary>
        <ul class="import-report">${g.rows.map(r => `<li class="${level}">row ${r.row}${r.name ? ': ' + escapeHtml(r.name) : ''}</li>`).join('')}</ul>
      </details>`).join('')}</div>`;
  };
  box.innerHTML = section('error', 'Skipped rows') + section('warn', 'Warnings — check these') + section('info', 'Filled in automatically');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Same task twice = same name, day, domain and note. Two "Dump" rows with different notes are both kept. */
function importKey(t) {
  return [t.name, t.date || '', t.domain || '', t.note || ''].join('|').toLowerCase();
}

export function commitImportedTasks(tasks, reports, monday) {
  ensureProjectsMigrated();
  const existing = new Set(state.tasks.map(t => importKey(t)));
  const ids = [];
  tasks.forEach(t => {
    const key = importKey(t);
    if (existing.has(key)) return;
    existing.add(key);
    state.tasks.push(t);
    ids.push(t.id);
  });
  const added = ids.length;
  if (added) {
    if (!Array.isArray(state.imports)) state.imports = [];
    state.imports.push({ id: uid(), from: tasks[0].imported.from, at: new Date().toISOString(), taskIds: ids });
  }
  deps.save();
  try { if (typeof deps.render === 'function') deps.render(); } catch (e) { console.warn('render after import', e); }
  try { if (typeof deps.renderDashboard === 'function') deps.renderDashboard(); } catch (e) { console.warn('dashboard after import', e); }
  showImportReport(document.getElementById('week-plan-msg'), added, reports, monday);
  renderImportHealth();
  try { if (typeof deps.switchPhase === 'function') deps.switchPhase('plan'); } catch (e) { console.warn('switchPhase after import', e); }
  return added;
}

export function importWeeklyPlanRows(rows) {
  const items = csvRowsToItems(rows);
  const { tasks, rows: reports } = validateAndBuildItems(items);
  if (!tasks.length && !reports.length) {
    const msg = document.getElementById('week-plan-msg');
    if (msg) msg.textContent = 'No tasks found in file.';
    return;
  }
  commitImportedTasks(tasks, reports);
}

export function importWeeklyPlanJson(obj, source) {
  const msg = document.getElementById('week-plan-msg');
  if (!obj || typeof obj !== 'object') {
    if (msg) msg.textContent = 'JSON must be an object with items[].';
    return;
  }
  const items = Array.isArray(obj.items) ? obj.items.map((it, i) => ({ ...it, _row: i + 1 })) : null;
  if (!items) {
    if (msg) msg.textContent = 'JSON missing items array (see schema/plan.schema.json).';
    return;
  }
  if (obj.version != null && obj.version !== 1) {
    if (msg) msg.textContent = `Unsupported plan version ${obj.version} (need 1).`;
    return;
  }
  // weekOf in the file wins over the Year week selection, so a plan lands on the week it was made for.
  const monday = parseYmd(obj.weekOf) ? mondayOnOrBefore(parseYmd(obj.weekOf)) : undefined;
  const { tasks, rows: reports } = validateAndBuildItems(items, { monday, source });
  commitImportedTasks(tasks, reports, monday);
}

/**
 * Per import: how many tasks were corrected by hand or deleted since.
 * v2 is done when three weekly imports in a row show zero of both.
 */
export function importHealth() {
  const byId = new Map(state.tasks.map(t => [t.id, t]));
  return (state.imports || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).map(imp => {
    let fixed = 0, deleted = 0;
    const fields = {};
    imp.taskIds.forEach(id => {
      const t = byId.get(id);
      if (!t) { deleted++; return; }
      // Only fields recorded at import time count (older imports predate some fields).
      const diff = IMPORT_FIELDS.filter(f => t.imported && f in t.imported && (t[f] ?? null) !== (t.imported[f] ?? null));
      if (diff.length) fixed++;
      diff.forEach(f => { fields[f] = (fields[f] || 0) + 1; });
    });
    return { ...imp, count: imp.taskIds.length, fixed, deleted, fields };
  });
}

/** Fill the Week-of picker with the default week the first time Plan renders. */
export function renderImportWeekHint() {
  const input = document.getElementById('week-plan-week');
  if (input && !input.value) input.value = formatYmd(defaultImportMonday());
}

export function renderImportHealth() {
  renderImportWeekHint();
  const el = document.getElementById('import-health');
  if (!el) return;
  const rows = importHealth().slice(0, 6);
  el.innerHTML = rows.length
    ? `<div class="section-label">Import accuracy · goal: 3 weeks in a row with 0 fixes</div>
      <ul class="plan-batch-list">${rows.map(r => {
        const what = Object.entries(r.fields).map(([f, n]) => `${f} ×${n}`).join(', ');
        return `<li><strong>${esc(r.from)}</strong> · ${r.count} imported · ${r.fixed} corrected · ${r.deleted} deleted${what ? ` — ${esc(what)}` : ''}</li>`;
      }).join('')}</ul>`
    : '';
}

export function importWeeklyPlanFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const msg = document.getElementById('week-plan-msg');
  if (msg) { msg.textContent = 'Reading ' + file.name + '…'; msg.classList.remove('err'); }
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    const reader = new FileReader();
    reader.onload = () => {
      try { importWeeklyPlanJson(JSON.parse(reader.result), file.name.replace(/\.json$/i, '')); }
      catch (e) { if (msg) msg.textContent = 'JSON parse failed.'; }
    };
    reader.readAsText(file);
  } else if (name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = () => {
      try { importWeeklyPlanRows(parseCsvText(reader.result)); }
      catch (e) {
        console.error(e);
        if (msg) msg.textContent = 'CSV import failed: ' + (e && e.message ? e.message : String(e));
      }
    };
    reader.readAsText(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded — check network/CDN');
        const wb = XLSX.read(reader.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        importWeeklyPlanRows(rows);
      } catch (e) {
        console.error(e);
        if (msg) msg.textContent = 'XLSX import failed: ' + (e && e.message ? e.message : String(e));
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (msg) {
    msg.textContent = 'Use .json (preferred), .csv, or .xlsx.';
  }
  input.value = '';
}
