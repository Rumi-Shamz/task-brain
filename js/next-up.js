/** Today: in-app reminders (what is on now, what is next) and the Delegated list. */
import { state, esc, todayYmd, parseHHMM, formatHHMM, DEFAULT_DURATION } from './state.js';
import { blocksOnDate, allDayOnDate, slippedTasks } from './blocks.js';
import { domainStyleVar } from './domains.js';
import { deps } from './deps.js';

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
    if (t.date !== ymd || !t.start || t.done || t.status === 'someday') return;
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

export function renderNextUp() {
  const el = document.getElementById('dash-next-up');
  if (!el) return;
  const ymd = todayYmd();
  if ((state.dashCalDate || ymd) !== ymd) { el.hidden = true; return; }
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const a = dayAgenda(ymd, nowMin);
  const slipped = slippedTasks().length;
  const chip = (i, label) => `<span class="next-chip ${i.kind}" style="${domainStyleVar(i.domain)}">${label}</span>`;
  const parts = [];
  a.now.forEach(i => parts.push(chip(i, `Now · ${esc(i.name)} until ${formatHHMM(i.end)}`)));
  a.next.forEach(i => parts.push(chip(i, `${formatHHMM(i.start)} ${esc(i.name)} · ${inHowLong(i.start - nowMin)}`)));
  allDayOnDate(ymd).forEach(b => parts.push(chip({ kind: 'event', domain: b.domain }, esc(b.name))));
  const counts = [
    a.openToday ? `${a.openToday} open today` : 'nothing open today',
    slipped ? `${slipped} slipped` : '',
  ].filter(Boolean).join(' · ');
  el.hidden = false;
  el.innerHTML = `${parts.join('') || '<span class="next-chip">Nothing else scheduled today</span>'}<span class="next-counts">${counts}</span>`;
}

let tick = null;
/** Keep the strip current while the app is open (no push notifications by design). */
export function startNextUpTicker() {
  if (tick) return;
  tick = setInterval(() => {
    if (document.getElementById('phase-dashboard')?.classList.contains('active')) renderNextUp();
  }, 60000);
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
  if (sum) sum.textContent = list.length ? `Delegated (${list.length})` : 'Delegated';
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
       ${ai.length ? `<p class="someday-hint">For the assistant — queued until it can run tasks.</p>${ai.map(row).join('')}` : ''}`
    : '<p class="dash-inbox-empty">Nothing delegated.</p>';
}
