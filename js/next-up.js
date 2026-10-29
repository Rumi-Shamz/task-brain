/** Today: in-app reminders (what is on now, what is next) and the Delegated list. */
import { state, esc, todayYmd, parseHHMM, formatHHMM, formatYmd, parseYmd, defaultWorkSchedule, DEFAULT_DURATION } from './state.js';
import { periodForDate } from './year-period.js';
import { blocksOnDate, allDayOnDate } from './blocks.js';
import { domainStyleVar } from './domains.js';
import { deps } from './deps.js';
import { agentTaskRowHTML, agentReadyCount, runnerStatusHTML } from './agent-ui.js';
import { isLocked } from './outcome.js';

function inHowLong(mins) {
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return `in ${h}h${m ? ` ${m}m` : ''}`;
}

/** Items on ymd around nowMin: appointments, containers, and scheduled open tasks. */
export function dayAgenda(ymd, nowMin) {
  const items = [];
  blocksOnDate(ymd).forEach(b => items.push({
    kind: b.rule === 'event' ? 'event' : 'block', name: b.name, start: b.startMin, end: b.endMin, domain: b.domain,
  }));
  state.tasks.forEach(t => {
    if (t.date !== ymd || !t.start || t.done || t.status === 'someday' || isLocked(t)) return;
    const start = parseHHMM(t.start);
    if (start == null) return;
    items.push({ kind: 'task', name: t.name, start, end: start + (Number(t.duration) || DEFAULT_DURATION), domain: t.domain, id: t.id });
  });
  items.sort((a, b) => a.start - b.start || (a.kind === 'task') - (b.kind === 'task'));
  return {
    now: items.filter(i => i.start <= nowMin && i.end > nowMin),
    next: items.filter(i => i.start > nowMin).slice(0, 3),
    openToday: state.tasks.filter(t => t.date === ymd && !t.done && t.status !== 'someday').length,
  };
}

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clockText(min) {
  return min === 12 * 60 ? 'noon' : min === 0 ? 'midnight' : formatHHMM(min);
}

/** "Work week, day 4 of 5" and when the other half starts, from the season's work window. */
export function periodLine(now = new Date(), schedule = (state.yearRhythm && state.yearRhythm.workSchedule) || defaultWorkSchedule()) {
  const ymd = formatYmd(now);
  const p = periodForDate(ymd, schedule);
  const day = p.dates.indexOf(ymd) + 1;
  const end = parseYmd(p.end);
  const switchText = `${p.kind === 'work' ? 'Rest' : 'Work'} starts ${WEEKDAY_LONG[end.getDay()]} at ${clockText(p.closeMin)}`;
  return { kind: p.kind, title: `${p.kind === 'work' ? 'Work week' : 'Rest'}, day ${day} of ${p.dates.length}`, switchText };
}

/**
 * The strip at the top of Act: what is on now (bold, highlighted), the next items, and where you are
 * in the work / rest rhythm. Only on today's view.
 */
export function renderNextUp() {
  const el = document.getElementById('dash-next-up');
  if (!el) return;
  const ymd = todayYmd();
  if ((state.dashCalDate || ymd) !== ymd) { el.hidden = true; return; }
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const a = dayAgenda(ymd, nowMin);
  // A task on now wins over the block it sits in.
  const now = a.now.find(i => i.kind === 'task') || a.now[0];
  const nowHTML = now
    ? `<span class="now-pill" style="${domainStyleVar(now.domain)}"><span class="now-dot" aria-hidden="true"></span><span class="now-label">Now</span>
        <strong class="now-name">${esc(now.name)}</strong><span class="now-until">until ${formatHHMM(now.end)}</span></span>`
    : `<span class="now-pill idle"><span class="now-label">Now</span><strong class="now-name">Nothing scheduled</strong></span>`;
  const nexts = a.next.map(i => `<span class="next-chip ${i.kind}" style="${domainStyleVar(i.domain)}">
      <span class="next-time">${formatHHMM(i.start)}</span> ${esc(i.name)} <span class="next-in">${inHowLong(i.start - nowMin)}</span></span>`).join('');
  const allDay = allDayOnDate(ymd).map(b => `<span class="next-chip event" style="${domainStyleVar(b.domain)}">${esc(b.name)}</span>`).join('');
  el.hidden = false;
  el.innerHTML = `${nowHTML}<span class="next-list">${nexts}${allDay}</span>`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Header, right side: "Thursday 29 Oct · 14:05" and where you are in the work / rest rhythm. */
export function renderHeaderInfo(d = new Date()) {
  const el = document.getElementById('header-info');
  if (!el) return;
  const period = state.yearRhythm ? periodLine(d) : null;
  el.innerHTML = `<span class="hi-date"><span class="hi-day">${WEEKDAY_LONG[d.getDay()]}</span> ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}</span>
    <strong class="hi-time">${formatHHMM(d.getHours() * 60 + d.getMinutes())}</strong>
    ${period ? `<span class="hi-period period-${period.kind}"><span class="hi-dot" aria-hidden="true"></span><strong>${esc(period.title)}</strong>
      <span class="hi-switch">${esc(period.switchText)}</span></span>` : ''}`;
}

let tick = null;
/** Keep the clock and the strip current while the app is open (no push notifications by design). */
export function startNextUpTicker() {
  if (tick) return;
  renderHeaderInfo();
  let lastMin = new Date().getMinutes();
  tick = setInterval(() => {
    const m = new Date().getMinutes();
    if (m === lastMin) return;
    lastMin = m;
    renderHeaderInfo();
    if (document.getElementById('phase-dashboard')?.classList.contains('active')) renderNextUp();
  }, 5000);
}

export function delegatedTasks() {
  return state.tasks.filter(t => !t.done && t.status !== 'someday' && (t.assignee === 'person' || t.assignee === 'ai'));
}

export function takeBackTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.assignee = 'me';
  deps.save();
  deps.renderDashboard();
}

export function renderDelegatedPanel() {
  const el = document.getElementById('delegated-panel');
  if (!el) return;
  const list = delegatedTasks();
  const sum = document.getElementById('delegated-summary');
  const ready = agentReadyCount();
  if (sum) sum.textContent = list.length ? `Delegated (${list.length}${ready ? ` · ${ready} to review` : ''})` : 'Delegated';
  const row = t => `<div class="someday-card">
      <div class="someday-name">${esc(t.name)}</div>
      <div class="someday-meta">${t.assignee === 'ai' ? 'Assistant' : `→ ${esc(t.delegateTo || 'someone')}`}${t.date ? ` · due ${esc(t.date)}` : ''}${t.note ? ` · ${esc(t.note.slice(0, 80))}` : ''}</div>
      <div class="someday-actions">
        <button type="button" class="btn" onclick="toggleTaskDone('${t.id}', true)">Done</button>
        <button type="button" class="btn" onclick="takeBackTask('${t.id}')">Take back</button>
      </div>
    </div>`;
  const people = list.filter(t => t.assignee === 'person');
  const ai = list.filter(t => t.assignee === 'ai');
  el.innerHTML = list.length
    ? `${people.length ? `<p class="someday-hint">Waiting on people — follow up if it is close to the date.</p>${people.map(row).join('')}` : ''}
       ${ai.length ? `<p class="someday-hint">For the assistant — the desktop runner picks these up within a few minutes. The note is the brief.</p>${runnerStatusHTML()}${ai.map(agentTaskRowHTML).join('')}` : ''}`
    : '<p class="dash-inbox-empty">Nothing delegated.</p>';
}
