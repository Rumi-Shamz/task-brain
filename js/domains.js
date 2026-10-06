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

/** Default colors (match the original CSS); custom domains take the palette in order. */
export const DEFAULT_DOMAIN_COLORS = {
  ALFA: '#E24B4A',
  SwingSociety: '#D4537E',
  SwingShuffle: '#378ADD',
  Dorst: '#EF9F27',
  Dev: '#5B8DEF',
  Personal: '#1D9E75',
};
const CUSTOM_DOMAIN_PALETTE = ['#7F77DD', '#2A9D8F', '#C17A3A', '#9B59B6', '#16A085', '#E76F51', '#8D99AE', '#B5838D'];

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
    out.push({ id, label, shared: !!d.shared, ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}) });
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

export function domainColor(domainId) {
  const id = normalizeDomainId(domainId) || domainId;
  const custom = state.domainColors && state.domainColors[id];
  if (custom) return custom;
  if (DEFAULT_DOMAIN_COLORS[id]) return DEFAULT_DOMAIN_COLORS[id];
  const i = (state.customDomains || []).findIndex(d => d.id === id);
  return i >= 0 ? CUSTOM_DOMAIN_PALETTE[i % CUSTOM_DOMAIN_PALETTE.length] : '#8D99AE';
}

export function setDomainColor(domainId, color) {
  if (!/^#[0-9a-f]{6}$/i.test(String(color || ''))) return;
  if (!state.domainColors || typeof state.domainColors !== 'object') state.domainColors = {};
  state.domainColors[domainId] = color;
}

export function normalizeDomainColors(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    Object.entries(raw).forEach(([k, v]) => { if (/^#[0-9a-f]{6}$/i.test(String(v))) out[k] = v; });
  }
  return out;
}

/** style="--dc:…" fragment for anything tinted by its domain. */
export function domainStyleVar(domainId) {
  return domainId ? `--dc:${domainColor(domainId)};` : '';
}
