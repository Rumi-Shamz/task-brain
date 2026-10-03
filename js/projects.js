/** Minimal project entity (T3). */
import { state, BUILTIN_PROJECTS, PROJECT_PALETTE, slugProjectId, isBuiltinProject } from './state.js';

export const ACTIVITIES = [
  { id: 'research', label: 'Research / Plan' },
  { id: 'communicate', label: 'Communicate' },
  { id: 'act', label: 'Act' },
  { id: 'learn', label: 'Learn' },
];

const BUILTIN_META = {
  'swing-shuffle': { name: 'Swing&Shuffle', domain: 'SwingShuffle' },
  alfa: { name: 'ALFA', domain: 'ALFA' },
  dorst: { name: 'Dorst', domain: 'Dorst' },
  personal: { name: 'Personal', domain: 'Personal' },
};

export function emptyProject(partial = {}) {
  return {
    id: partial.id || slugProjectId(partial.name || 'project'),
    name: partial.name || partial.label || 'Project',
    domain: partial.domain || 'Other',
    objective: partial.objective || '',
    deadline: partial.deadline || null,
    status: partial.status || 'active',
    people: Array.isArray(partial.people) ? partial.people : [],
    links: Array.isArray(partial.links) ? partial.links : [],
    color: partial.color || PROJECT_PALETTE[0],
  };
}

/** Ensure state.projects exists; migrate builtins + customProjects. */
export function ensureProjectsMigrated() {
  if (!Array.isArray(state.projects)) state.projects = [];
  const byId = new Map(state.projects.map(p => [p.id, p]));

  BUILTIN_PROJECTS.forEach((b, i) => {
    if (byId.has(b.id)) return;
    const meta = BUILTIN_META[b.id] || { name: b.label, domain: 'Other' };
    const p = emptyProject({
      id: b.id,
      name: meta.name,
      domain: meta.domain,
      color: PROJECT_PALETTE[i % PROJECT_PALETTE.length],
    });
    state.projects.push(p);
    byId.set(p.id, p);
  });

  (state.customProjects || []).forEach((c, i) => {
    if (!c || !c.id || byId.has(c.id)) return;
    const p = emptyProject({
      id: c.id,
      name: c.label || c.name,
      domain: c.domain || 'Other',
      color: c.color || PROJECT_PALETTE[i % PROJECT_PALETTE.length],
    });
    state.projects.push(p);
    byId.set(p.id, p);
  });

  // Migrate tasks: project → projectId, lane → activity
  state.tasks.forEach(t => {
    if (!t.projectId && t.project) t.projectId = t.project;
    if (!t.activity && t.lane) t.activity = t.lane;
    if (!t.activity) t.activity = 'act';
    if (t.activity === 'research' || t.lane === 'research') t.activity = 'research';
    // keep legacy mirrors for UI that still reads project/lane
    if (t.projectId) t.project = t.projectId;
    if (t.activity) t.lane = t.activity === 'learn' ? 'research' : t.activity;
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

export function upsertProject({ name, domain, objective, deadline, status, people, links, color }) {
  ensureProjectsMigrated();
  const id = slugProjectId(name);
  let p = state.projects.find(x => x.id === id);
  if (!p) {
    p = emptyProject({ id, name, domain, objective, deadline, status, people, links, color });
    state.projects.push(p);
    if (!isBuiltinProject(id) && !state.customProjects.some(c => c.id === id)) {
      state.customProjects.push({ id, label: name, domain: domain || 'Other', color: p.color });
    }
  } else {
    Object.assign(p, {
      name: name || p.name,
      domain: domain || p.domain,
      objective: objective != null ? objective : p.objective,
      deadline: deadline !== undefined ? deadline : p.deadline,
      status: status || p.status,
      people: people || p.people,
      links: links || p.links,
    });
  }
  return p;
}
