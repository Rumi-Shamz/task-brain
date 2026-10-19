/**
 * "Is this the same task?" without a model: compare the words of names and notes.
 * Used by the week-plan import to flag possible duplicates. It only flags; the owner decides.
 */

const STOP = new Set(`a an the so if go and or but of to for in on at by with from into about as is are be
  this that these those it its my our your their his her me we you they i
  do does done make get set up out off over via per vs not no yes all any some more
  week day today tomorrow monday tuesday wednesday thursday friday saturday sunday
  morning afternoon evening`.split(/\s+/).filter(Boolean));

/** Lowercase content words, plural/verb endings trimmed so "analysis"/"analyses", "review"/"reviewing" meet. */
export function words(text) {
  return [...new Set(String(text || '').toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[^a-z0-9à-ÿ]+/)
    .filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))
    .map(stem))];
}

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function shared(a, b) {
  const sb = new Set(b);
  return a.filter(w => sb.has(w));
}

/**
 * Why two tasks look like the same work, or null.
 *   name   most words of the shorter name are in the other name (at least two words in common)
 *   note   the notes say mostly the same thing
 *   both   every word of one name appears in the other task's note, in the same domain
 */
export function similarity(a, b) {
  const an = words(a.name), bn = words(b.name);
  if (!an.length || !bn.length) return null;
  const nameHits = shared(an, bn);
  if (an.join(' ') === bn.join(' ')) return { why: 'same name', score: 1 };
  const nameScore = nameHits.length / Math.min(an.length, bn.length);
  if (nameHits.length >= 2 && nameScore >= 2 / 3 - 1e-9) return { why: `names share "${nameHits.join(' ')}"`, score: nameScore };

  const ax = words(a.note), bx = words(b.note);
  if (ax.length >= 4 && bx.length >= 4) {
    const common = shared(ax, bx).length;
    const jaccard = common / (ax.length + bx.length - common);
    if (jaccard >= 0.5) return { why: 'notes say mostly the same', score: jaccard };
  }
  const sameDomain = (a.domain || '') === (b.domain || '');
  if (sameDomain && an.length >= 2 && shared(an, bx).length === an.length) return { why: `"${a.name}" is described in its note`, score: 0.6 };
  if (sameDomain && bn.length >= 2 && shared(bn, ax).length === bn.length) return { why: `its name is described in this note`, score: 0.6 };
  return null;
}

/** Best match among candidates (never itself, its parent, its children, or a sibling under the same parent). */
export function findSimilar(task, candidates) {
  let best = null;
  candidates.forEach(c => {
    if (!c || c.id === task.id || c.id === task.parentId || c.parentId === task.id) return;
    if (task.parentId && c.parentId === task.parentId) return;
    const s = similarity(task, c);
    if (s && (!best || s.score > best.score)) best = { ...s, match: c };
  });
  return best;
}
