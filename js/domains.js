/** Canonical + custom domains — Dashboard columns. */

import { state } from './state.js';

export const CANONICAL_DOMAINS = [
  { id: 'ALFA', label: 'ALFA', shared: true },
  { id: 'SwingSociety', label: 'Swing Society', shared: true },
  { id: 'SwingShuffle', label: 'Swing & Shuffle', shared: true },
  { id: 'Dorst', label: 'Dorst', shared: true },
  { id: 'Dev', label: 'Dev', shared: false },
  { id: 'Personal', label: 'Personal', shared: false },
];

/** @deprecated use allDomains() — kept for imports that expect DOMAINS array of objects */
export const DOMAINS = CANONICAL_DOMAINS;

export const DOMAIN_IDS = CANONICAL_DOMAINS.map(d => d.id);

const ALIASES = {
  alfa: 'ALFA',
  dorst: 'Dorst',
  personal: 'Personal',
  softwaredev: 'Dev',
  'software dev': 'Dev',
  dev: 'Dev',
  swingshuffle: 'SwingShuffle',
  'swing&shuffle': 'SwingShuffle',
  'swing & shuffle': 'SwingShuffle',
  swingsociety: 'SwingSociety',
  'swing society': 'SwingSociety',
  other: 'Personal',
};

export function normalizeCustomDomains(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set(DOMAIN_IDS);
  const out = [];
  list.forEach(d => {
    if (!d || typeof d !== 'object') return;
    let id = String(d.id || '').trim();
    const label = String(d.label || d.name || '').trim();
    if (!label) return;
    if (!id) {
      id = label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'domain';
    }
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label, shared: !!d.shared });
  });
  return out;
}

export function allDomains() {
  if (!Array.isArray(state.customDomains)) state.customDomains = [];
  return CANONICAL_DOMAINS.concat(state.customDomains);
}

export function normalizeDomainId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const all = allDomains();
  if (all.some(d => d.id === s)) return s;
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  if (ALIASES[key]) return ALIASES[key];
  const byLabel = all.find(d => d.label.toLowerCase() === key);
  if (byLabel) return byLabel.id;
  if (key.includes('swing') && key.includes('shuffle')) return 'SwingShuffle';
  if (key.includes('swing') && (key.includes('society') || key.includes('buzz'))) return 'SwingSociety';
  if (key === 'softwaredev' || key.includes('software')) return 'Dev';
  return null;
}

export function domainLabel(id) {
  const d = allDomains().find(x => x.id === id);
  return d ? d.label : id || 'Personal';
}

export function normalizeDomainsList(raw) {
  if (Array.isArray(raw)) {
    const out = [];
    raw.forEach(x => {
      const id = normalizeDomainId(x);
      if (id && !out.includes(id)) out.push(id);
    });
    return out.length ? out : ['Personal'];
  }
  const one = normalizeDomainId(raw);
  return one ? [one] : ['Personal'];
}

export function primaryDomain(projectOrTask) {
  if (!projectOrTask) return 'Personal';
  if (Array.isArray(projectOrTask.domains) && projectOrTask.domains.length) {
    return normalizeDomainId(projectOrTask.domains[0]) || 'Personal';
  }
  return normalizeDomainId(projectOrTask.domain) || 'Personal';
}

export function addCustomDomain(label) {
  const name = String(label || '').trim();
  if (!name) return { ok: false, error: 'Name required' };
  if (!Array.isArray(state.customDomains)) state.customDomains = [];
  const id = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'domain';
  if (allDomains().some(d => d.id === id || d.label.toLowerCase() === name.toLowerCase())) {
    return { ok: false, error: 'Domain already exists' };
  }
  state.customDomains.push({ id, label: name, shared: false });
  return { ok: true, id };
}

export function isDomainCollapsed(domainId) {
  if (!Array.isArray(state.collapsedDomains)) {
    // Default: collapse domains with no tasks
    return null;
  }
  return state.collapsedDomains.includes(domainId);
}

export function toggleDomainCollapsed(domainId) {
  if (!Array.isArray(state.collapsedDomains)) state.collapsedDomains = [];
  const i = state.collapsedDomains.indexOf(domainId);
  if (i >= 0) state.collapsedDomains.splice(i, 1);
  else state.collapsedDomains.push(domainId);
}

export function setAllDomainsCollapsed(collapsed) {
  if (collapsed) {
    state.collapsedDomains = allDomains().map(d => d.id);
  } else {
    state.collapsedDomains = [];
  }
}
