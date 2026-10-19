/** Year setup: work-season schedule and the 364-day protocol (cycles, deep rest, vacations). */
import {
  WEEKDAY_SHORT, clampHour, clampWeekdayIdx, dateForDay, defaultWorkSchedule, formatYmd,
  normalizeWorkSchedule, state, workWindowRuleText,
} from './state.js';
import { activityRules, cycleDayIndex } from './blocks.js';
import { deps } from './deps.js';
import { renderRecurringEditor } from './year-events.js';
import { renderYear } from './year.js';

export function renderYearScheduleControls() {
  const el = document.getElementById('year-schedule-controls');
  const rule = document.getElementById('year-schedule-rule');
  if (!state.yearRhythm) return;
  state.yearRhythm.workSchedule = normalizeWorkSchedule(state.yearRhythm.workSchedule);
  const s = state.yearRhythm.workSchedule;
  if (rule) { rule.textContent = 'Long: ' + workWindowRuleText(s.long) + ' · Short: ' + workWindowRuleText(s.short); }
  if (!el) return;
  const wdOpts = WEEKDAY_SHORT.map((label, i) => `<option value="${ i }">${ label }</option>`).join('');
  const seasonRow = (key, label) => {
    const spec = s[key];
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
      <strong style="min-width:90px;font-size:12px;">${ label }</strong>
      <label style="font-size:11px;color:var(--txt3);">Months
        <input data-ws="${ key }" data-field="months" value="${ spec.months.join(',') }" style="width:120px;margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);" />
      </label>
      <label style="font-size:11px;color:var(--txt3);">Start
        <select data-ws="${ key }" data-field="startWeekday" style="margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);">${ wdOpts }</select>
        <input type="number" min="0" max="23" data-ws="${ key }" data-field="startHour" value="${ spec.startHour }" style="width:52px;margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);" />
      </label>
      <label style="font-size:11px;color:var(--txt3);">End
        <select data-ws="${ key }" data-field="endWeekday" style="margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);">${ wdOpts }</select>
        <input type="number" min="0" max="23" data-ws="${ key }" data-field="endHour" value="${ spec.endHour }" style="width:52px;margin-left:4px;padding:3px 6px;border:0.5px solid var(--border-md);border-radius:var(--radius);background:var(--card);color:var(--txt);" />
      </label>
    </div>`;
  };
  el.innerHTML = seasonRow('long','Long season') + seasonRow('short','Short season')
    + `<button class="btn" type="button" onclick="resetWorkScheduleDefaults()">Reset schedule defaults</button>`;
  el.querySelectorAll('[data-ws]').forEach(inp => {
    const key = inp.getAttribute('data-ws');
    const field = inp.getAttribute('data-field');
    if (field === 'startWeekday' || field === 'endWeekday') inp.value = String(s[key][field]);
    const apply = () => {
      const spec = { ...state.yearRhythm.workSchedule[key] };
      if (field === 'months') {
        const months = String(inp.value).split(/[,\s]+/).map(x => parseInt(x,10)).filter(n => Number.isFinite(n) && n>=0 && n<=11);
        if (!months.length) return;
        spec.months = [...new Set(months)].sort((a,b)=>a-b);
      } else if (field === 'startHour' || field === 'endHour') { spec[field] = clampHour(inp.value); } else { spec[field] = clampWeekdayIdx(inp.value); }
      state.yearRhythm.workSchedule = normalizeWorkSchedule({ ...state.yearRhythm.workSchedule, [key]: spec });
      deps.save();
      deps.renderYear();
    };
    inp.onchange = apply;
    if (inp.tagName === 'INPUT' && inp.type !== 'number') inp.onblur = apply;
  });
}

export function resetWorkScheduleDefaults() { state.yearRhythm.workSchedule = defaultWorkSchedule();
  deps.save();
  deps.renderYear(); }

function protocolDate(day) {
  const d = dateForDay(state.yearRhythm.yearStartMonday, day);
  return d ? formatYmd(d) : '';
}

export function renderProtocolEditor() {
  const el = document.getElementById('year-protocol-editor');
  if (!el || !state.yearRhythm) return;
  const r = state.yearRhythm;
  const cycles = (r.cycles || []).map((c, i) =>
    `<label>Cycle ${i + 1}<input type="date" value="${protocolDate(c.startDay)}" onchange="setProtocolCycle(${i}, this.value)" /></label>`
  ).join('');
  const vacs = (r.vacations || []).map((v, i) =>
    `<label>Vacation ${i + 1}<input type="date" value="${protocolDate(v.startDay)}" onchange="setProtocolVacation(${i}, this.value)" /></label>`
  ).join('');
  el.innerHTML = `<div class="section-label">Protocol · repeats every 364 days</div>
    <div class="proto-grid">${cycles}
      <label>Deep rest<input type="date" value="${protocolDate(r.deepRest.startDay)}" onchange="setProtocolDeepRest(this.value)" /></label>
      ${vacs}
    </div>`;
  renderRecurringEditor();
}

export function setProtocolCycle(i, ymd) {
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null || !state.yearRhythm.cycles[i]) return;
  state.yearRhythm.cycles[i].startDay = idx;
  deps.save();
  deps.renderYear();
}

export function setProtocolVacation(i, ymd) {
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null || !state.yearRhythm.vacations[i]) return;
  state.yearRhythm.vacations[i].startDay = idx;
  deps.save();
  deps.renderYear();
}

export function setProtocolDeepRest(ymd) {
  const idx = cycleDayIndex(state.yearRhythm.yearStartMonday, ymd);
  if (idx == null) return;
  state.yearRhythm.deepRest.startDay = idx;
  deps.save();
  deps.renderYear();
}

export function removeActivityRule(id) {
  state.activityRules = activityRules().filter(r => r.id !== id);
  deps.save();
  deps.renderYear();
}
