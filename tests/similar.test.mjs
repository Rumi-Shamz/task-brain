import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarity, findSimilar, words } from '../js/similar.js';

test('words drop filler, keep short terms like DJ, and meet across endings', () => {
  assert.deepEqual(words('Build the DJ training programs [middle]'), ['build', 'dj', 'train', 'program']);
});

test('names with most words in common are flagged; different work is not', () => {
  assert.ok(similarity({ name: 'Build DJ training program' }, { name: 'DJ Program Launch' }));
  assert.ok(similarity({ name: 'Product cost analysis' }, { name: 'Product costs analysis 2' }));
  assert.equal(similarity({ name: 'Book doctor checkup' }, { name: 'Monday DJ set' }), null);
  assert.equal(similarity({ name: 'Review co-founder agreement' }, { name: 'Schedule lawyer meeting' }), null);
});

test('notes count: same description, or a name spelled out in another task\'s note', () => {
  const a = { name: 'Lawyer call', domain: 'SwingShuffle', note: 'Contact the lawyer to arrange a meeting about the co-founder agreement and beta documents' };
  const b = { name: 'Legal prep', domain: 'SwingShuffle', note: 'Arrange a meeting with the lawyer about co-founder agreement and the beta documents' };
  assert.match(similarity(a, b).why, /notes/);
  const c = { name: 'Beta documents for lawyer', domain: 'SwingShuffle', note: '' };
  assert.ok(similarity(c, a), 'every word of the name is in the other note');
  assert.equal(similarity({ ...c, domain: 'Dorst' }, a), null, 'only within a domain');
});

test('parents, children and siblings are never flagged', () => {
  const parent = { id: 'p', name: 'Launch personal website' };
  const review = { id: 'r', name: 'Review personal website', parentId: 'p' };
  const ship = { id: 's', name: 'Ship personal website', parentId: 'p' };
  assert.equal(findSimilar(ship, [parent, review]), null);
  assert.equal(findSimilar(ship, [{ id: 'x', name: 'Ship personal website now' }]).match.id, 'x');
});
