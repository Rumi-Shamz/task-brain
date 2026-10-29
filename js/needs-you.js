/**
 * Act → Needs you: everything waiting on a decision, in one list with one count. Slipped tasks,
 * backlog items due for review, and assistant work that finished or failed. Each item carries its
 * own decisions, so nothing hides behind a collapsed panel.
 */
import { state, esc } from './state.js';
import { slippedTasks } from './blocks.js';
import { somedayDue } from './someday.js';
import { taskAgentStatus } from './agent-core.js';
import { domainLabel } from './domains.js';

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
    return `<div class="needs-item">
      <div class="needs-kind">${n === 1 ? 'Slipped once' : n === 2 ? 'Slipped twice' : `Slipped ${n} times`}, now on ${esc(t.date || 'no day')} · ${esc(where)}</div>
      <div class="needs-name">${esc(t.name)}</div>
      <div class="needs-actions">
        ${btn('Pick a day', `openDeferMenu('${id}', event)`, true)}
        ${btn('Backlog', `slippedToSomeday('${id}')`)}
        ${btn('Delete', `somedayDelete('${id}')`)}
      </div>
    </div>`;
  }
  if (kind === 'review') {
    return `<div class="needs-item">
      <div class="needs-kind">Backlog review${t.deleteCandidate ? ', pushed back 3 times' : ''} · ${esc(where)}</div>
      <div class="needs-name">${esc(t.name)}</div>
      <div class="needs-actions">
        ${btn('Schedule', `openDeferMenu('${id}', event)`, true)}
        ${btn('Delegate', `somedayDelegate('${id}')`)}
        ${btn('Ask again in 2 weeks', `somedayDefer('${id}')`)}
        ${btn('Delete', `somedayDelete('${id}')`)}
      </div>
    </div>`;
  }
  return `<div class="needs-item">
    <div class="needs-kind">${kind === 'result' ? 'Assistant finished' : 'Assistant run failed'}</div>
    <div class="needs-name">${esc(t.name)}</div>
    <div class="needs-actions">${btn(kind === 'result' ? 'See result' : 'See what happened', "openDelegatedPanel()", true)}</div>
  </div>`;
}

export function renderNeedsYou() {
  const el = document.getElementById('needs-you');
  if (!el) return;
  const items = needsYouItems();
  el.hidden = !items.length;
  el.innerHTML = items.length
    ? `<h2 class="needs-title">Needs you <span class="panel-count attention">${items.length}</span></h2>
      <div class="needs-list">${items.map(itemHTML).join('')}</div>`
    : '';
}

/** Open the Delegated panel and bring it into view (from "See result"). */
export function openDelegatedPanel() {
  const panel = document.getElementById('delegated-panel');
  const details = panel && panel.closest('details');
  if (details) details.open = true;
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
