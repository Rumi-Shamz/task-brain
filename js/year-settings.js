/** Year setup: work-season schedule and the 364-day protocol (cycles, deep rest, vacations). */
import {
  WEEKDAY_SHORT, clampHour, clampWeekdayIdx, dateForDay, defaultWorkSchedule, formatYmd,
  normalizeWorkSchedule, state, workWindowRuleText,
} from './state.js';
import { activityRules, cycleDayIndex } from './blocks.js';
import { deps } from './deps.js';
import { renderRecurringEditor } from './year-events.js';
import { renderYear } from './year.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_NAME = { long: 'Long work week', short: 'Short work week' };

/**
 * Seasons: every month belongs to the long or the short work week (click a month to move it), and
 * each season has its own work window, e.g. Monday noon to Friday noon.
 */
export function renderYearScheduleControls() {
  const el = document.getElementById('year-schedule-controls');
  const rule = document.getElementById('year-schedule-rule');
  if (!state.yearRhythm) return;
  state.yearRhythm.workSchedule = normalizeWorkSchedule(state.yearRhythm.workSchedule);
  const s = state.yearRhythm.workSchedule;
  if (rule) { rule.textContent = 'Long: ' + workWindowRuleText(s.long) + '. Short: ' + workWindowRuleText(s.short) + '.'; }
  if (!el) return;
  const wdSelect = (key, field) => `<select data-ws="${ key }" data-field="${ field }" aria-label="${ SEASON_NAME[key] } ${ field === 'startWeekday' ? 'start day' : 'end day' }">
      ${ WEEKDAY_SHORT.map((label, i) => `<option value="${ i }" ${ s[key][field] === i ? 'selected' : '' }>${ label }</option>`).join('') }</select>`;
  const hourSelect = (key, field) => `<select data-ws="${ key }" data-field="${ field }" aria-label="${ SEASON_NAME[key] } ${ field === 'startHour' ? 'start time' : 'end time' }">
      ${ Array.from({ length: 24 }, (_, h) => `<option value="${ h }" ${ s[key][field] === h ? 'selected' : '' }>${ h === 12 ? 'noon' : String(h).padStart(2, '0') + ':00' }</option>`).join('') }</select>`;
  const windowRow = key => `<div class="season-window">
      <span class="season-swatch season-${ key }" aria-hidden="true"></span><strong>${ SEASON_NAME[key] }</strong>
      <span>work from</span>${ wdSelect(key, 'startWeekday') }${ hourSelect(key, 'startHour') }
      <span>to</span>${ wdSelect(key, 'endWeekday') }${ hourSelect(key, 'endHour') }
    </div>`;
  el.innerHTML = `<div class="season-months" role="group" aria-label="Which work week each month uses">
      ${ MONTHS.map((m, i) => {
        const key = s.short.months.includes(i) ? 'short' : 'long';
        return `<button type="button" class="season-month season-${ key }" aria-pressed="${ key === 'short' }"
          title="${ m }: ${ SEASON_NAME[key].toLowerCase() }. Click to switch." onclick="toggleSeasonMonth(${ i })">${ m }<small>${ key === 'short' ? 'short' : 'long' }</small></button>`;
      }).join('') }
    </div>
    ${ windowRow('long') }${ windowRow('short') }
    <button class="btn" type="button" onclick="resetWorkScheduleDefaults()">Restore default seasons</button>`;
  el.querySelectorAll('select[data-ws]').forEach(inp => {
    inp.onchange = () => {
      const key = inp.getAttribute('data-ws');
      const field = inp.getAttribute('data-field');
      const spec = { ...state.yearRhythm.workSchedule[key] };
      spec[field] = field.endsWith('Hour') ? clampHour(inp.value) : clampWeekdayIdx(inp.value);
      state.yearRhythm.workSchedule = normalizeWorkSchedule({ ...state.yearRhythm.workSchedule, [key]: spec });
      deps.save();
      deps.renderYear();
    };
  });
}

/** Move one month to the other season. A season keeps at least one month. */
export function toggleSeasonMonth(month) {
  const s = normalizeWorkSchedule(state.yearRhythm.workSchedule);
  const from = s.short.months.includes(month) ? 'short' : 'long';
  const to = from === 'short' ? 'long' : 'short';
  if (s[from].months.length <= 1) return;
  s[from] = { ...s[from], months: s[from].months.filter(m => m !== month) };
  s[to] = { ...s[to], months: [...new Set([...s[to].months, month])].sort((a, b) => a - b) };
  state.yearRhythm.workSchedule = normalizeWorkSchedule(s);
  deps.save();
  deps.renderYear();
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
  el.innerHTML = `<div class="section-label">Protocol start dates (they repeat every 364 days)</div>
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
