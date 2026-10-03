/** Project entity under Domains (many-to-many via project.domains[]). */
import { state, BUILTIN_PROJECTS, PROJECT_PALETTE, slugProjectId, isBuiltinProject } from './state.js';
import { DOMAINS, normalizeDomainId, normalizeDomainsList, primaryDomain } from './domains.js';

export const ACTIVITIES = [
  { id: 'research', label: 'Research / Plan' },
  { id: 'communicate', label: 'Communicate' },
  { id: 'act', label: 'Act' },
  { id: 'learn', label: 'Learn' },
];

const BUILTIN_META = {
  'swing-shuffle': { name: 'Swing&Shuffle', domains: ['SwingShuffle'] },
  alfa: { name: 'ALFA', domains: ['ALFA'] },
  dorst: { name: 'Dorst', domains: ['Dorst'] },
  personal: { name: 'Personal', domains: ['Personal'] },
  unassigned: { name: 'Unassigned', domains: ['Personal'] },
};

export function emptyProject(partial = {}) {
  const domains = normalizeDomainsList(partial.domains || partial.domain || 'Personal');
  return {
    id: partial.id || slugProjectId(partial.name || 'project'),
    name: partial.name || partial.label || 'Project',
    domains,
    domain: domains[0],
    objective: partial.objective || '',
    deadline: partial.deadline || null,
    status: partial.status || 'active',
    people: Array.isArray(partial.people) ? partial.people : [],
    links: Array.isArray(partial.links) ? partial.links : [],
    color: partial.color || PROJECT_PALETTE[0],
  };
}

function syncCustomMirror(p) {
  if (isBuiltinProject(p.id)) return;
  let c = (state.customProjects || []).find(x => x.id === p.id);
  if (!c) {
    c = { id: p.id, label: p.name, domains: p.domains, domain: p.domain, color: p.color };
    state.customProjects.push(c);
  } else {
    c.label = p.name;
    c.domains = p.domains;
    c.domain = p.domain;
    if (p.color) c.color = p.color;
  }
}

/** Ensure state.projects exists; migrate builtins + customProjects + domains[]. */
export function ensureProjectsMigrated() {
  if (!Array.isArray(state.projects)) state.projects = [];
  const byId = new Map(state.projects.map(p => [p.id, p]));

  BUILTIN_PROJECTS.forEach((b, i) => {
    const meta = BUILTIN_META[b.id] || { name: b.label, domains: ['Personal'] };
    if (byId.has(b.id)) {
      const p = byId.get(b.id);
      p.domains = normalizeDomainsList(p.domains || p.domain || meta.domains);
      p.domain = p.domains[0];
      return;
    }
    const p = emptyProject({
      id: b.id,
      name: meta.name,
      domains: meta.domains,
      color: PROJECT_PALETTE[i % PROJECT_PALETTE.length],
    });
    state.projects.push(p);
    byId.set(p.id, p);
  });

  // Ensure Unassigned bucket exists for missing-domain imports
  if (!byId.has('unassigned')) {
    const u = emptyProject({
      id: 'unassigned',
      name: 'Unassigned',
      domains: ['Personal'],
      color: PROJECT_PALETTE[4],
    });
    state.projects.push(u);
    byId.set('unassigned', u);
    if (!state.customProjects.some(c => c.id === 'unassigned')) {
      state.customProjects.push({ id: 'unassigned', label: 'Unassigned', domain: 'Personal', domains: ['Personal'], color: u.color });
    }
  }

  (state.customProjects || []).forEach((c, i) => {
    if (!c || !c.id) return;
    if (byId.has(c.id)) {
      const p = byId.get(c.id);
      p.domains = normalizeDomainsList(c.domains || c.domain || p.domains || p.domain);
      p.domain = p.domains[0];
      return;
    }
    const p = emptyProject({
      id: c.id,
      name: c.label || c.name,
      domains: c.domains || c.domain || 'Personal',
      color: c.color || PROJECT_PALETTE[i % PROJECT_PALETTE.length],
    });
    state.projects.push(p);
    byId.set(p.id, p);
  });

  state.projects.forEach(p => {
    p.domains = normalizeDomainsList(p.domains || p.domain);
    p.domain = p.domains[0];
  });

  state.tasks.forEach(t => {
    if (!t.projectId && t.project) t.projectId = t.project;
    if (!t.activity && t.lane) t.activity = t.lane;
    if (!t.activity) t.activity = 'act';
    if (t.projectId) t.project = t.projectId;
    if (t.activity) t.lane = t.activity === 'learn' ? 'research' : t.activity;
    const dom = normalizeDomainId(t.domain);
    if (dom) t.domain = dom;
    else if (t.projectId) {
      const p = byId.get(t.projectId);
      t.domain = p ? primaryDomain(p) : 'Personal';
    } else {
      t.domain = 'Personal';
    }
  });
}

export function allProjectEntities() {
  ensureProjectsMigrated();
  return state.projects;
}

export function getProject(id) {
  ensureProjectsMigrated();
  return state.projects.find(p => p.id === id) || null;
}

export function projectsInDomain(domainId) {
  ensureProjectsMigrated();
  const d = normalizeDomainId(domainId) || 'Personal';
  return state.projects.filter(p => (p.domains || []).includes(d) || p.domain === d);
}

/**
 * Create or reuse a project under a domain. Does NOT collapse whole domain → one id
 * unless the label literally matches the domain default project.
 */
export function ensureProjectForDomain(domainId, projectLabel) {
  ensureProjectsMigrated();
  const domain = normalizeDomainId(domainId) || 'Personal';
  let label = String(projectLabel || '').trim();
  if (!label) label = 'Unassigned';

  // Exact builtin match by label only
  const builtinHit = BUILTIN_PROJECTS.find(b => b.label.toLowerCase() === label.toLowerCase());
  if (builtinHit) {
    const p = getProject(builtinHit.id);
    if (p && !p.domains.includes(domain)) {
      p.domains.push(domain);
      p.domain = p.domains[0];
      syncCustomMirror(p);
    }
    return builtinHit.id;
  }

  if (/^unassigned$/i.test(label)) return 'unassigned';

  const slug = String(label).trim().toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'project';

  let existing = state.projects.find(
    p => p.id === slug || (p.name || '').toLowerCase() === label.toLowerCase()
  );
  if (existing) {
    if (!existing.domains.includes(domain)) {
      existing.domains.push(domain);
      existing.domain = existing.domains[0];
    }
    syncCustomMirror(existing);
    return existing.id;
  }

  const id = slugProjectId(label);
  const color = PROJECT_PALETTE[state.projects.length % PROJECT_PALETTE.length];
  const p = emptyProject({ id, name: label, domains: [domain], color });
  state.projects.push(p);
  syncCustomMirror(p);
  return id;
}

export function upsertProject({ name, domain, domains, objective, deadline, status, people, links, color }) {
  ensureProjectsMigrated();
  const id = slugProjectId(name);
  let p = state.projects.find(x => x.id === id);
  const doms = normalizeDomainsList(domains || domain || 'Personal');
  if (!p) {
    p = emptyProject({ id, name, domains: doms, objective, deadline, status, people, links, color });
    state.projects.push(p);
  } else {
    Object.assign(p, {
      name: name || p.name,
      domains: doms,
      domain: doms[0],
      objective: objective != null ? objective : p.objective,
      deadline: deadline !== undefined ? deadline : p.deadline,
      status: status || p.status,
      people: people || p.people,
      links: links || p.links,
    });
  }
  syncCustomMirror(p);
  return p;
}

/** Merge source project ids into survivor; reassign tasks; remove empty customs. */
export function mergeProjects(survivorId, sourceIds) {
  ensureProjectsMigrated();
  const survivor = getProject(survivorId);
  if (!survivor) return { ok: false, error: 'Survivor project not found' };
  const sources = (sourceIds || []).filter(id => id && id !== survivorId);
  sources.forEach(sid => {
    const src = getProject(sid);
    if (src) {
      (src.domains || []).forEach(d => {
        if (!survivor.domains.includes(d)) survivor.domains.push(d);
      });
      survivor.domain = survivor.domains[0];
    }
    state.tasks.forEach(t => {
      if (t.project === sid || t.projectId === sid) {
        t.project = survivorId;
        t.projectId = survivorId;
        t.domain = primaryDomain(survivor);
      }
    });
    if (!isBuiltinProject(sid) && sid !== 'unassigned') {
      state.projects = state.projects.filter(p => p.id !== sid);
      state.customProjects = (state.customProjects || []).filter(c => c.id !== sid);
    }
  });
  syncCustomMirror(survivor);
  return { ok: true, survivorId, merged: sources.length };
}

export function listMergeCandidates() {
  ensureProjectsMigrated();
  return state.projects
    .filter(p => p.id !== 'unassigned')
    .map(p => ({
      id: p.id,
      name: p.name,
      domains: p.domains,
      taskCount: state.tasks.filter(t => t.project === p.id || t.projectId === p.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { DOMAINS, primaryDomain };
