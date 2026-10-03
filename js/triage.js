import {
  state, esc, BUILTIN_PROJECTS, PROJECT_PALETTE, DEFAULT_DURATION,
  slugProjectId, isBuiltinProject, allProjects, newTask,
  dateForDay, mondayOfWeek, mondayOnOrBefore, addDaysLocal,
  formatYmd, parseYmd, formatHHMM, chipControlsHTML, projectClass,
  setHideDone, toggleTaskDone, startTaskTimer, pauseTaskTimer, stopTaskTimer,
} from './state.js';
import { deps } from './deps.js';

/* ---------- Weekly plan import (CSV / XLSX) ---------- */
export const SLOT_START = { morning: 9 * 60, afternoon: 13 * 60, evening: 18 * 60 };
export const DAY_OFFSET = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

export function ensureProjectFromDomain(domain) {
  const raw = String(domain || '').trim();
  if (!raw) return null;
  const n = raw.toLowerCase();
  if (n.includes('swing') && n.includes('shuffle')) return 'swing-shuffle';
  if (n === 'alfa') return 'alfa';
  if (n === 'dorst') return 'dorst';
  if (n === 'personal') return 'personal';
  // SwingBuzz, Swing Society, Other, etc. → custom project
  const existing = allProjects().find(p => p.label.toLowerCase() === n || p.id === slugProjectId(raw));
  if (existing) return existing.id;
  const id = slugProjectId(raw);
  if (!isBuiltinProject(id) && !state.customProjects.some(p => p.id === id)) {
    state.customProjects.push({ id, label: raw, color: PROJECT_PALETTE[state.customProjects.length % PROJECT_PALETTE.length] });
  }
  return id;
}

export function weekMondayForImport() {
  // state.yearWeekMonday is a day index into the personal year (0–363).
  if (state.yearRhythm && state.yearRhythm.yearStartMonday != null && state.yearWeekMonday != null) {
    const d = dateForDay(state.yearRhythm.yearStartMonday, mondayOfWeek(state.yearWeekMonday));
    if (d) return d;
  }
  return mondayOnOrBefore(new Date());
}

export function parseWeeklyPlanRows(rows) {
  if (!rows || !rows.length) return [];
  const header = rows[0].map(h => String(h || '').trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const col = { key: idx(['key word', 'keyword', 'task', 'title', 'name']), domain: idx(['domain', 'project']), priority: idx(['priority']), pressure: idx(['timepressure', 'time pressure']), slot: idx(['allotted time', 'slot', 'time of day']), day: idx(['allotted day', 'day', 'weekday']), length: idx(['length', 'duration', 'minutes']), sessions: idx(['sessions']), desc: idx(['description', 'notes', 'details']) };
  const out = [];
  // Stack overlapping same-day slots so Afternoon Tuesday×2 don't collide.
  const nextFree = {}; // `${ date }|${ slot }` → minutes
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const nameRaw = String(row[col.key] || '').trim();
    if (!nameRaw) continue;
    const done = /✕|✗|×/.test(nameRaw) || /✕|✗|×/.test(String(row[col.pressure] || ''));
    const name = nameRaw.replace(/\s*[✕✗×]\s*$/u, '').trim();
    if (!name) continue;
    const domain = col.domain >= 0 ? row[col.domain] : '';
    const project = ensureProjectFromDomain(domain);
    const slotKey = String(row[col.slot] || '').trim().toLowerCase();
    const dayKey = String(row[col.day] || '').trim().toLowerCase();
    const length = Math.max(15, Math.round(Number(row[col.length]) || DEFAULT_DURATION));
    const pressure = String(row[col.pressure] || '').trim().toLowerCase();
    const priority = Number(row[col.priority]);
    const desc = col.desc >= 0 ? String(row[col.desc] || '').trim() : '';
    let start = null;
    let date = null;
    if (DAY_OFFSET[dayKey] != null && SLOT_START[slotKey] != null) {
      const mon = weekMondayForImport();
      const dayDate = addDaysLocal(mon, DAY_OFFSET[dayKey]);
      date = formatYmd(dayDate);
      const stackKey = date + '|' + slotKey;
      const preferred = SLOT_START[slotKey];
      const placed = nextFree[stackKey] != null ? nextFree[stackKey] : preferred;
      start = formatHHMM(placed);
      nextFree[stackKey] = placed + length;
    }
    let size = null;
    if (priority >= 3) size = 'complex';
    else if (priority >= 2) size = 'mid';
    else if (priority >= 1) size = 'simple';
    out.push(newTask(name, { project, lane: 'act', date, start, duration: length, done, blocking: pressure === 'urgent' ? true : null, who: desc.slice(0, 120), size }));
  }
  return out;
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

export function importWeeklyPlanRows(rows) {
  const msg = document.getElementById('week-plan-msg');
  const imported = parseWeeklyPlanRows(rows);
  if (!imported.length) {
    if (msg) msg.textContent = 'No tasks found in file.';
    return;
  }
  // Replace overlapping names from plan? Append; skip exact name+date duplicates.
  const existing = new Set(state.tasks.map(t => (t.name + '|' + (t.date || '')).toLowerCase()));
  let added = 0;
  imported.forEach(t => {
    const key = (t.name + '|' + (t.date || '')).toLowerCase();
    if (existing.has(key)) return;
    existing.add(key);
    state.tasks.push(t);
    added++;
  });
  deps.save();
  deps.render();
  if (typeof renderDashboard === 'function') deps.renderDashboard();
  if (msg) { msg.textContent = 'Imported ' + added + ' task' + (added === 1 ? '' : 's') +
      ' into projects/slots (week of ' + formatYmd(weekMondayForImport()) + ').'; }
  deps.switchPhase('dashboard');
}

export function importWeeklyPlanFile(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  const msg = document.getElementById('week-plan-msg');
  if (msg) msg.textContent = 'Reading ' + file.name + '…';
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
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
        if (msg) msg.textContent = 'XLSX parse failed — try exporting CSV, or check network for SheetJS.';
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (msg) { msg.textContent = 'Use a .csv or .xlsx file.'; }
  input.value = '';
}

export function uid() { return Math.random().toString(36).slice(2, 8); }

export function addSingle() {
  const inp = document.getElementById('single-input');
  const val = inp.value.trim();
  if (!val) return;
  state.tasks.push(newTask(val));
  inp.value = '';
  deps.save(); deps.render();
}

export function toggleBulk() {
  const el = document.getElementById('bulk-area');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

export function importBulk() {
  const lines = document.getElementById('bulk-input').value.split('\n').map(l => l.trim()).filter(Boolean);
  lines.forEach(name => state.tasks.push(newTask(name)));
  document.getElementById('bulk-input').value = '';
  toggleBulk();
  deps.save(); deps.render();
}

export function deleteTask(id) { state.tasks = state.tasks.filter(t => t.id !== id); deps.save(); deps.render(); }

export function setSize(id, size) {
  const t = state.tasks.find(t => t.id === id);
  if (!t) return;
  t.size = t.size === size ? null : size;
  if (t.size && (t.size === 'complex' || t.size === 'mid') && t.subtasks.length === 0) {
    t.subtasks = [{ id: uid(), text: '' }, { id: uid(), text: '' }];
  }
  deps.save(); deps.render();
}

export function setBlocking(id, val) { const t = state.tasks.find(t => t.id === id); if (t) { t.blocking = val; deps.save(); deps.render(); } }
export function setLT(id, val) { const t = state.tasks.find(t => t.id === id); if (t) { t.lt = val; deps.save(); deps.render(); } }
export function updateWho(id, val) { const t = state.tasks.find(t => t.id === id); if (t) { t.who = val; deps.save(); } }
export function addSubtask(id) { const t = state.tasks.find(t => t.id === id); if (t && t.subtasks.length < 9) { t.subtasks.push({ id: uid(), text: '' }); deps.save(); deps.render(); } }
export function updateSubtask(tid, sid, val) { const t = state.tasks.find(t => t.id === tid); if (t) { const s = t.subtasks.find(s => s.id === sid); if (s) { s.text = val; deps.save(); } } }
export function removeSubtask(tid, sid) { const t = state.tasks.find(t => t.id === tid); if (t) { t.subtasks = t.subtasks.filter(s => s.id !== sid); deps.save(); deps.render(); } }
export function toggleDraining(id) { const t = state.tasks.find(t => t.id === id); if (t) { t.draining = !t.draining; deps.save(); deps.renderSchedule(); } }

export function toggleTriageForm(id) {
  const el = document.getElementById('tf-' + id);
  const arrow = document.getElementById('arr-' + id);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▸ triage' : '▴ triage';
}


export function groupSelected() {
  const checked = [...document.querySelectorAll('.group-cb:checked')].map(el => el.dataset.id);
  if (checked.length < 2) return;
  state.groupCounter++;
  const gName = `Group ${state.groupCounter}`;
  state.groups[gName] = checked;
  checked.forEach(id => { const t = state.tasks.find(t => t.id === id); if (t) t.group = gName; });
  deps.save(); deps.renderOrganize();
}

export function clearSelection() { document.querySelectorAll('.group-cb').forEach(cb => cb.checked = false);
  updateSelCount(); }

export function updateSelCount() {
  const n = document.querySelectorAll('.group-cb:checked').length;
  document.getElementById('sel-count').textContent = n > 0 ? `${ n } selected` : '';
}


export const setWho = updateWho;

export function renderTriage() {
  const el = document.getElementById('task-list');
  if (!state.tasks.length) { el.innerHTML = '<div class="empty-state">No tasks yet — add one above.</div>'; return; }
  el.innerHTML = state.tasks.map(t => {
    const sizeClass = t.size ? `triaged ${t.size}` : '';
    const subHTML = (t.size === 'complex' || t.size === 'mid') ? `
      <div class="subtask-list">
        ${t.subtasks.map(s => `
          <div class="subtask-row">
            <div class="subtask-dot"></div>
            <input class="subtask-input" value="${esc(s.text)}" placeholder="subtask..." oninput="updateSubtask('${t.id}','${s.id}',this.value)" />
            <span class="task-del" onclick="removeSubtask('${t.id}','${s.id}')">✕</span>
          </div>`).join('')}
        ${t.subtasks.length < 9 ? `<span class="toggle-triage" onclick="addSubtask('${t.id}')">+ subtask</span>` : ''}
      </div>` : '';
    return `<div class="task-card ${sizeClass}">
      <div class="task-top">
        <span class="task-name">${esc(t.name)}</span>
        <span class="task-del" onclick="deleteTask('${t.id}')">✕</span>
      </div>
      <span class="toggle-triage" id="arr-${t.id}" onclick="toggleTriageForm('${t.id}')">▸ triage</span>
      <div class="triage-form" id="tf-${t.id}" style="display:none;">
        <div class="triage-grid">
          <div class="triage-field">
            <span class="triage-label">Who is affected</span>
            <input type="text" value="${esc(t.who)}" placeholder="person / org" oninput="updateWho('${t.id}',this.value)" />
          </div>
          <div class="triage-field">
            <span class="triage-label">Blocking</span>
            <div class="blocking-toggle">
              <span class="pill ${t.blocking === true ? 'active-yn' : ''}" onclick="setBlocking('${t.id}',true)">Yes</span>
              <span class="pill ${t.blocking === false ? 'active-yn' : ''}" onclick="setBlocking('${t.id}',false)">No</span>
            </div>
          </div>
          <div class="triage-field">
            <span class="triage-label">Long-term value</span>
            <div class="lt-toggle">
              <span class="pill ${t.lt === true ? 'active-yn' : ''}" onclick="setLT('${t.id}',true)">Yes</span>
              <span class="pill ${t.lt === false ? 'active-yn' : ''}" onclick="setLT('${t.id}',false)">No</span>
            </div>
          </div>
          <div class="triage-field">
            <span class="triage-label">Size</span>
            <div class="size-pills">
              <span class="pill ${t.size === 'complex' ? 'active-complex' : ''}" onclick="setSize('${t.id}','complex')">Complex</span>
              <span class="pill ${t.size === 'mid' ? 'active-mid' : ''}" onclick="setSize('${t.id}','mid')">Mid</span>
              <span class="pill ${t.size === 'simple' ? 'active-simple' : ''}" onclick="setSize('${t.id}','simple')">Simple</span>
            </div>
          </div>
        </div>
        ${subHTML}
      </div>
    </div>`;
  }).join('');
}
