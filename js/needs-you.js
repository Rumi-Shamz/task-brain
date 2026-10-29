/**
 * Act → Needs you: everything waiting on a decision, in one list with one count. Slipped tasks,
 * backlog items due for review, and assistant work that finished or failed. Each item carries its
 * own decisions, so nothing hides behind a collapsed panel.
 */
import { state, esc } from './state.js';
import { slippedTasks } from './blocks.js';
import { somedayDue } from './someday.js';
import { taskAgentStatus } from './agent-core.js';
import { domainLabel, domainDotHTML, normalizeDomainId } from './domains.js';

/** The items, most urgent first: slipped (most misses first), then reviews, then assistant results. */
export function needsYouItems() {
  const items = [];
  slippedTasks().forEach(t => items.push({ kind: 'slipped', t }));
  somedayDue().forEach(t => items.push({ kind: 'review', t }));
  state.tasks
    .filter(t => t.assignee === 'ai' && !t.done && t.status !== 'someday')
    .forEach(t => {
      const s = taskAgentStatus(t, state.agentResults).state;
      if (s === 'ready' || s === 'failed') items.push({ kind: s === 'ready' ? 'result' : 'failed', t });
    });
  return items;
}

const btn = (label, onclick, main = false) =>
  `<button type="button" class="pill ${main ? 'pill-main' : ''}" onclick="${onclick}">${esc(label)}</button>`;

function itemHTML({ kind, t }) {
  const id = esc(t.id);
  const where = t.domain ? domainLabel(t.domain) : 'No domain';
  if (kind === 'slipped') {
    const n = t.missed.length;
    return `<div class="needs-item"><div class="needs-text">
      <div class="needs-kind">${n === 1 ? 'Slipped once' : n === 2 ? 'Slipped twice' : `Slipped ${n} times`}, now on <span class="num">${esc(t.date || 'no day')}</span> · ${esc(where)}</div>
      <div class="needs-name">${domainDotHTML(normalizeDomainId(t.domain))}${esc(t.name)}</div></div>
      <div class="needs-actions">
        ${btn('Done', `toggleTaskDone('${id}', true)`)}
        ${btn('Pick a day', `openDeferMenu('${id}', event)`, true)}
        ${btn('Backlog', `slippedToSomeday('${id}')`)}
        ${btn('Delete', `somedayDelete('${id}')`)}
      </div>
    </div>`;
  }
  if (kind === 'review') {
    return `<div class="needs-item"><div class="needs-text">
      <div class="needs-kind">Backlog review${t.deleteCandidate ? ', pushed back 3 times' : ''} · ${esc(where)}</div>
      <div class="needs-name">${domainDotHTML(normalizeDomainId(t.domain))}${esc(t.name)}</div></div>
      <div class="needs-actions">
        ${btn('Done', `toggleTaskDone('${id}', true)`)}
        ${btn('Schedule', `openDeferMenu('${id}', event)`, true)}
        ${btn('Delegate', `somedayDelegate('${id}')`)}
        ${btn('Ask again in 2 weeks', `somedayDefer('${id}')`)}
        ${btn('Delete', `somedayDelete('${id}')`)}
      </div>
    </div>`;
  }
  return `<div class="needs-item"><div class="needs-text">
    <div class="needs-kind">${kind === 'result' ? 'Assistant finished' : 'Assistant run failed'}</div>
    <div class="needs-name">${domainDotHTML(normalizeDomainId(t.domain))}${esc(t.name)}</div></div>
    <div class="needs-actions">${btn(kind === 'result' ? 'See result' : 'See what happened', "openDelegatedPanel()", true)}</div>
  </div>`;
}

/** Act's right column shows one view at a time: Domains (the board) or Needs you. */
export function setBoardView(view) {
  state.boardView = view === 'needs' ? 'needs' : 'domains';
  renderNeedsYou();
}

export function renderNeedsYou() {
  const el = document.getElementById('needs-you');
  if (!el) return;
  const items = needsYouItems();
  const view = state.boardView === 'needs' ? 'needs' : 'domains';
  const panel = document.getElementById('dash-board-panel');
  if (panel) panel.dataset.view = view;
  const sw = document.getElementById('board-switch');
  if (sw) {
    sw.innerHTML = [['domains', 'Domains', ''], ['needs', 'Needs you', items.length ? `<span class="panel-count attention">${items.length}</span>` : '']]
      .map(([v, l, extra]) => `<button type="button" role="tab" aria-selected="${v === view}" class="seg-tab ${v === view ? 'active' : ''}" onclick="setBoardView('${v}')">${l}${extra}</button>`)
      .join('');
  }
  const onBoard = state.dashMobileScreen === 'board';
  document.getElementById('dash-tab-day')?.classList.toggle('active', !onBoard);
  document.getElementById('dash-tab-domains')?.classList.toggle('active', onBoard && view === 'domains');
  const needsTab = document.getElementById('dash-tab-needs');
  if (needsTab) {
    needsTab.classList.toggle('active', onBoard && view === 'needs');
    needsTab.innerHTML = `Needs you${items.length ? ` <span class="panel-count attention">${items.length}</span>` : ''}`;
  }
  el.innerHTML = items.length
    ? `<div class="needs-list">${items.map(itemHTML).join('')}</div>`
    : '<p class="dash-inbox-empty">Nothing needs you right now.</p>';
}

/** Open the Delegated panel and bring it into view (from "See result"). */
export function openDelegatedPanel() {
  if (state.boardView === 'needs') setBoardView('domains');
  const panel = document.getElementById('delegated-panel');
  const details = panel && panel.closest('details');
  if (details) details.open = true;
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
