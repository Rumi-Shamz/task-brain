import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { registerActions, dispatch, act, actOn, stop, attrJson } from '../js/actions.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

// ---- static check: every action named in markup is registered ----

/** Modules reachable from js/app.js (dead modules are not part of the app). */
function reachable() {
  const seen = new Set();
  const walk = f => {
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of read(`js/${f}`).matchAll(/from '\.\/([\w-]+\.js)'/g)) walk(m[1]);
    for (const m of read(`js/${f}`).matchAll(/import\('\.\/([\w-]+\.js)'\)/g)) walk(m[1]);
  };
  walk('app.js');
  return [...seen];
}

function exportsOf(file) {
  const s = read(`js/${file}`);
  const out = new Set();
  for (const m of s.matchAll(/export (?:async )?(?:function|const|let|class) (\w+)/g)) out.add(m[1]);
  for (const m of s.matchAll(/export \* from '\.\/([\w-]+\.js)'/g)) exportsOf(m[1]).forEach(n => out.add(n));
  for (const m of s.matchAll(/export \{([^}]*)\}/g)) {
    for (const x of m[1].split(',')) { const n = x.trim().split(/\s+as\s+/).pop(); if (n) out.add(n); }
  }
  return out;
}

function callBody(s, from) {
  let depth = 0, i = s.indexOf('(', from);
  const start = i + 1;
  for (; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return s.slice(start, i);
  }
  return '';
}

function splitTop(body) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of body) {
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function registeredNames(files) {
  const names = new Set();
  for (const f of files) {
    const s = read(`js/${f}`);
    const ns = {};
    for (const m of s.matchAll(/import \* as (\w+) from '\.\/([\w-]+\.js)'/g)) ns[m[1]] = m[2];
    for (const m of s.matchAll(/registerActions\(/g)) {
      const body = callBody(s, m.index).replace(/\/\/.*$/gm, '');
      for (const arg of splitTop(body)) {
        const a = arg.trim();
        if (ns[a]) exportsOf(ns[a]).forEach(n => names.add(n));
        else if (a.startsWith('{')) {
          for (const item of splitTop(a.slice(1, a.lastIndexOf('}')))) {
            const k = /^\s*(\w+)/.exec(item);
            if (k) names.add(k[1]);
          }
        }
      }
    }
  }
  return names;
}

function usedNames(sources) {
  const used = new Map();
  const add = (n, where) => { if (!used.has(n)) used.set(n, where); };
  for (const [where, s] of sources) {
    for (const m of s.matchAll(/\sdata-(?:click|dblclick|change|input|keydown|submit|dragstart|dragend|dragover|dragleave|drop|pointerdown|mousedown|mousemove|focusin|focusout|toggle)="(\w+)"/g)) add(m[1], where);
    for (const m of s.matchAll(/\bact\(\s*'(\w+)'/g)) add(m[1], where);
    for (const m of s.matchAll(/\bactOn\(\s*'\w+'\s*,\s*'(\w+)'/g)) add(m[1], where);
  }
  return used;
}

test('every action named in index.html and the app modules is registered', () => {
  const files = reachable();
  const registered = registeredNames(files);
  const sources = [['index.html', read('index.html')], ...files.filter(f => f !== 'actions.js').map(f => [`js/${f}`, read(`js/${f}`)])];
  const used = usedNames(sources);
  assert.ok(used.size > 100, `expected many actions, found ${used.size}`);
  const missing = [...used].filter(([n]) => !registered.has(n)).map(([n, w]) => `${n} (${w})`);
  assert.deepEqual(missing, []);
});

test('no inline on* handler attributes remain', () => {
  const files = ['index.html', ...readdirSync(new URL('js/', root)).filter(f => f.endsWith('.js')).map(f => `js/${f}`)];
  const bad = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => { if (/\son[a-z]+=["'`$]/.test(line)) bad.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});

// ---- dispatcher ----

function el(attrs = {}, parent = null) {
  return {
    nodeType: 1, parentElement: parent, dataset: {},
    getAttribute: k => (k in attrs ? attrs[k] : null),
    hasAttribute: k => k in attrs,
    ...(attrs.__props || {}),
  };
}
function fakeEvent(target) {
  const e = { target, stopped: false, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() {} };
  return e;
}

test('act() encodes arguments so quotes and ampersands survive a single-quoted attribute', () => {
  const html = act('go', "it's <b> & \"x\"", { n: 1 });
  const m = /data-args='([^']*)'/.exec(html);
  assert.ok(m, html);
  const decoded = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  assert.deepEqual(JSON.parse(decoded), ["it's <b> & \"x\"", { n: 1 }]);
  assert.equal(attrJson(['a']), '[&quot;a&quot;]');
  assert.equal(actOn('change', 'f', '$value'), ` data-change="f" data-change-args='[&quot;$value&quot;]'`);
  assert.equal(stop('click', 'pointerdown'), ' data-stop="click pointerdown"');
});

test('dispatch replaces value tokens, also inside objects', () => {
  const calls = [];
  registerActions({ rec: (...a) => calls.push(a) });
  const input = el({ 'data-change': 'rec', 'data-change-args': '[{"d":"$number","v":"$value"},"$checked","$el","plain"]' });
  input.value = '30'; input.checked = true;
  dispatch('change', fakeEvent(input));
  assert.deepEqual(calls[0].slice(0, 2), [{ d: 30, v: '30' }, true]);
  assert.equal(calls[0][2], input);
  assert.equal(calls[0][3], 'plain');
});

test('an inner action also reaches the outer one, unless data-stop is set on the way up', () => {
  const log = [];
  registerActions({ inner: () => log.push('inner'), outer: () => log.push('outer') });
  const row = el({ 'data-click': 'outer' });
  const btn = el({ 'data-click': 'inner' }, row);
  dispatch('click', fakeEvent(btn));
  assert.deepEqual(log, ['inner', 'outer']);

  log.length = 0;
  const controls = el({ 'data-stop': 'pointerdown click' }, row);
  const plain = el({}, controls);
  const btn2 = el({ 'data-click': 'inner' }, controls);
  dispatch('click', fakeEvent(btn2));
  dispatch('click', fakeEvent(plain));
  assert.deepEqual(log, ['inner'], 'the stop element ends the walk, with or without an action of its own');
  const ev = fakeEvent(el({ 'data-click': 'inner', 'data-stop': 'click' }, row));
  log.length = 0;
  dispatch('click', ev);
  assert.deepEqual(log, ['inner']);
  assert.equal(ev.stopped, true);
  log.length = 0;
  dispatch('pointerdown', fakeEvent(plain));
  assert.deepEqual(log, []);
});

test('toggle does not bubble to ancestors', () => {
  const log = [];
  registerActions({ t: () => log.push('t') });
  const outer = el({ 'data-toggle': 't' });
  dispatch('toggle', fakeEvent(el({}, outer)));
  assert.deepEqual(log, []);
});

test('modules that use act/actOn/stop do not shadow them with a local name', () => {
  const bad = [];
  for (const f of readdirSync(new URL('js/', root)).filter(x => x.endsWith('.js') && x !== 'actions.js')) {
    const s = read(`js/${f}`);
    const m = /import \{([^}]*)\} from '\.\/actions\.js'/.exec(s);
    if (!m) continue;
    for (const n of m[1].split(',').map(x => x.trim())) {
      if (new RegExp(`\\b(?:const|let|var)\\s+${n}\\b|\\(\\s*${n}\\s*[,)]|[,(]\\s*${n}\\s*=>`).test(s.replace(m[0], ''))) bad.push(`${f}: ${n}`);
    }
  }
  assert.deepEqual(bad, []);
});
