/**
 * Validating week-plan import (JSON preferred, CSV legacy).
 * Schema source of truth: schema/plan.schema.json
 */
import {
  state, PROJECT_PALETTE, DEFAULT_DURATION, slugProjectId, isBuiltinProject, allProjects,
  newTask, dateForDay, mondayOfWeek, mondayOnOrBefore, addDaysLocal, formatYmd, formatHHMM,
} from './state.js';
import { deps } from './deps.js';

export const DOMAINS = ['ALFA', 'Dorst', 'SwingShuffle', 'SwingSociety', 'SoftwareDev', 'Personal', 'Other'];
export const LENGTHS = [15, 30, 60, 180];
export const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };
export const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

/** Legacy CSV domain/project labels → { domain, projectLabel } */
const DOMAIN_ALIASES = {
  alfa: { domain: 'ALFA', project: 'ALFA' },
  dorst: { domain: 'Dorst', project: 'Dorst' },
  personal: { domain: 'Personal', project: 'Personal' },
  other: { domain: 'Other', project: 'Other' },
  softwaredev: { domain: 'SoftwareDev', project: 'SoftwareDev' },
  'software dev': { domain: 'SoftwareDev', project: 'SoftwareDev' },
  swingshuffle: { domain: 'SwingShuffle', project: 'Swing&Shuffle' },
  'swing&shuffle': { domain: 'SwingShuffle', project: 'Swing&Shuffle' },
  'swing & shuffle': { domain: 'SwingShuffle', project: 'Swing&Shuffle' },
  swingsociety: { domain: 'SwingSociety', project: 'Swing Society' },
  'swing society': { domain: 'SwingSociety', project: 'Swing Society' },
  swingbuzz: { domain: 'SwingSociety', project: 'Swing Buzz' },
  'swing buzz': { domain: 'SwingSociety', project: 'Swing Buzz' },
};

export function resolveDomainProject(rawDomain) {
  const raw = String(rawDomain || '').trim();
  if (!raw) return { domain: null, project: null, warnings: ['missing domain'] };
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  if (DOMAIN_ALIASES[key]) {
    return { ...DOMAIN_ALIASES[key], warnings: [] };
  }
  if (key.includes('swing') && key.includes('shuffle')) {
    return { domain: 'SwingShuffle', project: raw, warnings: [] };
  }
  // Unknown label → Other domain, keep as project name
  return { domain: 'Other', project: raw, warnings: [`unknown domain "${raw}" mapped to Other`] };
}

export function ensureProjectRecord(domain, projectLabel) {
  const label = (projectLabel || domain || 'Other').trim();
  // Map builtins by domain for stable ids
  const builtinByDomain = {
    SwingShuffle: 'swing-shuffle',
    ALFA: 'alfa',
    Dorst: 'dorst',
    Personal: 'personal',
  };
  if (builtinByDomain[domain] && label.toLowerCase().includes(domain === 'SwingShuffle' ? 'shuffle' : domain.toLowerCase())) {
    return builtinByDomain[domain];
  }
  if (domain === 'SwingShuffle' && /shuffle/i.test(label)) return 'swing-shuffle';
  if (domain === 'ALFA') return 'alfa';
  if (domain === 'Dorst') return 'dorst';
  if (domain === 'Personal' && /^personal$/i.test(label)) return 'personal';

  const existing = allProjects().find(p => p.label.toLowerCase() === label.toLowerCase() || p.id === slugProjectId(label));
  if (existing) return existing.id;
  const id = slugProjectId(label);
  if (!isBuiltinProject(id) && !state.customProjects.some(p => p.id === id)) {
    state.customProjects.push({
      id,
      label,
      domain: domain || 'Other',
      color: PROJECT_PALETTE[state.customProjects.length % PROJECT_PALETTE.length],
    });
  }
  return id;
}

export function weekMondayForImport() {
  if (state.yearRhythm && state.yearRhythm.yearStartMonday != null && state.yearWeekMonday != null) {
    const d = dateForDay(state.yearRhythm.yearStartMonday, mondayOfWeek(state.yearWeekMonday));
    if (d) return d;
  }
  return mondayOnOrBefore(new Date());
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

/** @returns {{ tasks: object[], rows: {row:number, level:string, message:string}[] }} */
export function validateAndBuildItems(items) {
  const reports = [];
  const tasks = [];
  const nextFree = {};
  const mon = weekMondayForImport();

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
    warnings.push(...(dom.warnings || []));
    if (!dom.domain) {
      // Keep data: empty domain → Other (common on completed CSV rows).
      dom = { domain: 'Other', project: name, warnings: [] };
      warnings.push('missing domain → Other');
    }
    const projectLabel = item.project || dom.project || dom.domain;
    const projectId = ensureProjectRecord(dom.domain, projectLabel);

    const pr = normalizePriority(item.priority);
    if (pr.error) { reports.push({ row, level: 'error', message: pr.error + ` ("${name}")` }); return; }
    if (pr.warning) warnings.push(pr.warning);

    const tp = normalizePressure(item.timepressure);
    if (tp.error) { reports.push({ row, level: 'error', message: tp.error + ` ("${name}")` }); return; }

    const len = snapLength(item.length);
    if (len.warning) warnings.push(len.warning);

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
      warnings.push(`someday reviewAt defaulted to ${reviewAt}`);
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
      who: String(item.description || '').trim().slice(0, 120),
      size,
      priority: pr.value,
      timepressure: tp.value,
    });
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
    domain: idx(['domain', 'project']),
    priority: idx(['priority']),
    pressure: idx(['timepressure', 'time pressure']),
    slot: idx(['allotted time', 'slot', 'time of day']),
    day: idx(['allotted day', 'day', 'weekday']),
    length: idx(['length', 'duration', 'minutes']),
    sessions: idx(['sessions']),
    desc: idx(['description', 'notes', 'details']),
  };
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = String(row[col.key] || '').trim();
    if (!name) continue;
    items.push({
      _row: r + 1,
      name,
      domain: col.domain >= 0 ? row[col.domain] : '',
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

function showImportReport(msgEl, added, reports) {
  const errors = reports.filter(r => r.level === 'error');
  const warns = reports.filter(r => r.level === 'warn');
  const lines = [
    `Imported ${added} task${added === 1 ? '' : 's'} (week of ${formatYmd(weekMondayForImport())}).`,
  ];
  if (errors.length) lines.push(`${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  errors.slice(0, 12).forEach(e => lines.push(`  · row ${e.row}: ${e.message}`));
  if (warns.length) lines.push(`${warns.length} warning${warns.length === 1 ? '' : 's'}:`);
  warns.slice(0, 12).forEach(w => lines.push(`  · row ${w.row}: ${w.message}`));
  if (msgEl) {
    msgEl.textContent = lines.join('\n');
    msgEl.style.whiteSpace = 'pre-wrap';
    msgEl.classList.toggle('err', errors.length > 0);
  }
  const box = document.getElementById('week-plan-report');
  if (box) {
    box.innerHTML = reports.length
      ? `<ul class="import-report">${reports.map(r =>
          `<li class="${r.level}">row ${r.row}: ${escapeHtml(r.message)}</li>`).join('')}</ul>`
      : '';
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function commitImportedTasks(tasks, reports) {
  const existing = new Set(state.tasks.map(t => (t.name + '|' + (t.date || '')).toLowerCase()));
  let added = 0;
  tasks.forEach(t => {
    const key = (t.name + '|' + (t.date || '')).toLowerCase();
    if (existing.has(key)) return;
    existing.add(key);
    state.tasks.push(t);
    added++;
  });
  deps.save();
  deps.render();
  if (typeof deps.renderDashboard === 'function') deps.renderDashboard();
  showImportReport(document.getElementById('week-plan-msg'), added, reports);
  deps.switchPhase('dashboard');
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

export function importWeeklyPlanJson(obj) {
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
  const { tasks, rows: reports } = validateAndBuildItems(items);
  commitImportedTasks(tasks, reports);
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
      try { importWeeklyPlanJson(JSON.parse(reader.result)); }
      catch (e) { if (msg) msg.textContent = 'JSON parse failed.'; }
    };
    reader.readAsText(file);
  } else if (name.endsWith('.csv')) {
    const reader = new FileReader();
    reader.onload = () => {
      try { importWeeklyPlanRows(parseCsvText(reader.result)); }
      catch (e) { if (msg) msg.textContent = 'CSV parse failed.'; }
    };
    reader.readAsText(file);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');
        const wb = XLSX.read(reader.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        importWeeklyPlanRows(rows);
      } catch (e) {
        if (msg) msg.textContent = 'XLSX parse failed — try CSV or JSON.';
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (msg) {
    msg.textContent = 'Use .json (preferred), .csv, or .xlsx.';
  }
  input.value = '';
}
