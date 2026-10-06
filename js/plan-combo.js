/** Plan card comboboxes: domain, project (with create), and parent task. */
import { state, esc } from './state.js';
import { allDomains, domainLabel, normalizeDomainId } from './domains.js';
import { projectsInDomain } from './projects.js';
import { currentPlanTask, parentTaskLabel, wouldCreateParentCycle, planDomainChanged } from './plan.js';

let comboHighlight = { domain: -1, project: -1, parent: -1 };

export function comboHTML(kind, { valueId, valueLabel, placeholder }) {
  return `<div class="plan-combo" data-combo="${kind}">
    <input type="text" id="plan-${kind}-q" class="plan-combo-q" role="combobox"
      aria-autocomplete="list" aria-expanded="false" aria-controls="plan-${kind}-list"
      autocomplete="off" placeholder="${esc(placeholder)}"
      value="${esc(valueLabel || '')}"
      onfocus="planComboOpen('${kind}')"
      oninput="planComboFilter('${kind}')"
      onkeydown="planComboKey(event,'${kind}')"
      onblur="planComboBlur('${kind}')" />
    <input type="hidden" id="plan-${kind}" value="${esc(valueId || '')}" />
    <ul class="plan-combo-list" id="plan-${kind}-list" role="listbox" hidden></ul>
  </div>`;
}

function comboOptions(kind, query) {
  const q = String(query || '').trim().toLowerCase();
  if (kind === 'domain') {
    return allDomains()
      .filter(d => !q || d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q))
      .map(d => ({ id: d.id, label: d.label, create: false }));
  }
  if (kind === 'parent') {
    const t = currentPlanTask();
    const opts = [{ id: '', label: '— None (top-level) —', create: false }];
    state.tasks
      .filter(x => x.status !== 'someday' && x.id !== t?.id && !wouldCreateParentCycle(t?.id, x.id))
      .filter(x => !q || x.name.toLowerCase().includes(q))
      .slice(0, 40)
      .forEach(x => opts.push({ id: x.id, label: x.name, create: false }));
    return opts;
  }
  const t = currentPlanTask();
  const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || t?.domain) || 'Personal';
  const projects = projectsInDomain(dom);
  const matches = projects
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .map(p => ({ id: p.id, label: p.name, create: false }));
  const exact = projects.some(p => p.name.toLowerCase() === q);
  if (q && !exact) {
    matches.push({ id: '__create__', label: `Create “${query.trim()}”`, create: true, name: query.trim() });
  }
  return matches;
}

function renderComboList(kind, queryOverride) {
  const qEl = document.getElementById(`plan-${kind}-q`);
  const list = document.getElementById(`plan-${kind}-list`);
  if (!qEl || !list) return;
  const query = queryOverride !== undefined ? queryOverride : qEl.value;
  const opts = comboOptions(kind, query);
  if (comboHighlight[kind] >= opts.length) comboHighlight[kind] = opts.length - 1;
  list.innerHTML = opts.length
    ? opts.map((o, i) => `<li role="option" class="plan-combo-opt ${o.create ? 'create' : ''} ${i === comboHighlight[kind] ? 'active' : ''}"
        data-id="${esc(o.id)}" data-name="${esc(o.create ? o.name : o.label)}" data-create="${o.create ? '1' : '0'}"
        onmousedown="event.preventDefault();planComboPickFromEl('${kind}',this)">${esc(o.label)}</li>`).join('')
    : `<li class="plan-combo-empty">No matches</li>`;
  list.hidden = false;
  qEl.setAttribute('aria-expanded', 'true');
}

export function planComboOpen(kind) {
  comboHighlight[kind] = 0;
  const qEl = document.getElementById(`plan-${kind}-q`);
  const hidden = document.getElementById(`plan-${kind}`);
  // Opening on a committed value: show full list, select text for quick retype/search
  if (qEl && hidden?.value && hidden.value !== '__create__') {
    renderComboList(kind, '');
    qEl.select();
    return;
  }
  renderComboList(kind);
}

export function planComboFilter(kind) {
  const hidden = document.getElementById(`plan-${kind}`);
  // Typing clears committed id until a pick / blur resolve
  if (hidden) hidden.value = '';
  comboHighlight[kind] = 0;
  renderComboList(kind);
}

export function planComboBlur(kind) {
  setTimeout(() => {
    const list = document.getElementById(`plan-${kind}-list`);
    const qEl = document.getElementById(`plan-${kind}-q`);
    const hidden = document.getElementById(`plan-${kind}`);
    if (!qEl || !hidden) return;
    if (list) { list.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
    // Resolve typed text to a match or (project) create-on-commit marker
    const q = qEl.value.trim();
    if (!q) {
      if (kind === 'domain') {
        const t = currentPlanTask();
        const id = t?.domain || 'Personal';
        hidden.value = id;
        qEl.value = domainLabel(id);
      } else if (kind === 'parent') {
        hidden.value = '';
        qEl.value = '';
      }
      return;
    }
    if (kind === 'domain') {
      const ql = q.toLowerCase();
      const hit = allDomains().find(d => d.label.toLowerCase() === ql || d.id.toLowerCase() === ql)
        || allDomains().find(d => d.label.toLowerCase().startsWith(ql))
        || null;
      const id = hit?.id || normalizeDomainId(q) || currentPlanTask()?.domain || 'Personal';
      if (hidden.value !== id) planDomainChanged(id);
      else { hidden.value = id; qEl.value = domainLabel(id); }
      return;
    }
    if (kind === 'parent') {
      if (hidden.value) {
        qEl.value = parentTaskLabel(hidden.value);
        return;
      }
      const hit = state.tasks.find(x => x.status !== 'someday' && x.name.toLowerCase() === q.toLowerCase());
      if (hit && !wouldCreateParentCycle(currentPlanTask()?.id, hit.id)) {
        hidden.value = hit.id;
        qEl.value = hit.name;
      } else {
        hidden.value = '';
        qEl.value = '';
      }
      return;
    }
    // project
    if (hidden.value && hidden.value !== '__create__') {
      const t = currentPlanTask();
      const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || t?.domain) || 'Personal';
      const p = projectsInDomain(dom).find(x => x.id === hidden.value);
      if (p) qEl.value = p.name;
      return;
    }
    const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || currentPlanTask()?.domain) || 'Personal';
    const hit = projectsInDomain(dom).find(p => p.name.toLowerCase() === q.toLowerCase());
    if (hit) {
      hidden.value = hit.id;
      qEl.value = hit.name;
    } else {
      hidden.value = '__create__';
      // keep typed name in the query field for commit
    }
  }, 120);
}

export function planComboPickFromEl(kind, el) {
  if (!el) return;
  planComboPick(kind, el.dataset.id, el.dataset.create === '1' ? el.dataset.name : null);
}

export function planComboPick(kind, id, createName) {
  const qEl = document.getElementById(`plan-${kind}-q`);
  const hidden = document.getElementById(`plan-${kind}`);
  const list = document.getElementById(`plan-${kind}-list`);
  if (!qEl || !hidden) return;
  if (kind === 'domain') {
    planDomainChanged(id);
    return;
  }
  if (kind === 'parent') {
    const t = currentPlanTask();
    if (id && wouldCreateParentCycle(t?.id, id)) {
      hidden.value = '';
      qEl.value = '';
    } else {
      hidden.value = id || '';
      qEl.value = id ? parentTaskLabel(id) : '';
    }
    if (list) { list.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
    return;
  }
  if (id === '__create__' || createName) {
    hidden.value = '__create__';
    qEl.value = createName || qEl.value.trim();
  } else {
    hidden.value = id;
    const t = currentPlanTask();
    const dom = normalizeDomainId(document.getElementById('plan-domain')?.value || t?.domain) || 'Personal';
    const p = projectsInDomain(dom).find(x => x.id === id);
    qEl.value = p ? p.name : qEl.value;
  }
  if (list) { list.hidden = true; qEl.setAttribute('aria-expanded', 'false'); }
}

export function planComboKey(e, kind) {
  const list = document.getElementById(`plan-${kind}-list`);
  if (!list || list.hidden) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      planComboOpen(kind);
    }
    return;
  }
  const opts = [...list.querySelectorAll('.plan-combo-opt')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    comboHighlight[kind] = Math.min(opts.length - 1, (comboHighlight[kind] ?? -1) + 1);
    renderComboList(kind);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    comboHighlight[kind] = Math.max(0, (comboHighlight[kind] ?? 0) - 1);
    renderComboList(kind);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const i = comboHighlight[kind] ?? 0;
    const opt = opts[i];
    if (opt) planComboPickFromEl(kind, opt);
  } else if (e.key === 'Escape') {
    list.hidden = true;
    document.getElementById(`plan-${kind}-q`)?.setAttribute('aria-expanded', 'false');
  }
}
