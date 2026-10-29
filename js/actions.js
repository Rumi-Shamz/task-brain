/**
 * Delegated event actions. Markup never carries inline on* handlers; it names an action instead.
 *
 *   data-<type>="actionName"          type: click, dblclick, change, input, keydown, submit, dragstart,
 *                                     dragend, dragover, dragleave, drop, pointerdown, mousedown,
 *                                     mousemove, focusin, focusout, toggle
 *   data-args='[...]'                 JSON array of arguments for data-click (also read as a fallback
 *                                     for any type without its own list)
 *   data-<type>-args='[...]'          arguments for that event type
 *   data-stop="click pointerdown"     event types that must not bubble past this element (the same
 *                                     as an inline event.stopPropagation())
 *
 * Argument tokens, replaced at dispatch time (also inside nested arrays and objects):
 *   "$value"   el.value                "$number"  Number(el.value)       "$checked"  el.checked
 *   "$open"    el.open (details)       "$el"      the element that carries the attribute
 *   "$event"   the event (event.currentTarget is set to that element, as with an inline handler)
 *
 * Bubbling is replayed the way the browser does it: every element from event.target upwards that has a
 * matching data-<type> runs, nearest first, until one of them lists the type in data-stop.
 * Build the attributes with act() / actOn() / stop() so values are encoded and escaped correctly.
 */

const registry = new Map();

/** Register actions: objects of name -> function (module namespaces work too). */
export function registerActions(...maps) {
  for (const m of maps) {
    for (const [name, fn] of Object.entries(m || {})) if (typeof fn === 'function') registry.set(name, fn);
  }
}

export function hasAction(name) { return registry.has(name); }

/** JSON that is safe inside a single-quoted HTML attribute. */
export function attrJson(v) {
  return JSON.stringify(v).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nameAttr(name) { return String(name).replace(/[^\w.-]/g, ''); }

/** Attributes for an action on another event type: actOn('change', 'planPatch', { duration: '$number' }). */
export function actOn(type, name, ...args) {
  const argsAttr = args.length ? ` data-${type === 'click' ? '' : `${type}-`}args='${attrJson(args)}'` : '';
  return ` data-${type}="${nameAttr(name)}"${argsAttr}`;
}

/** Attributes for a click action: act('planPatch', { size: 'simple' }). */
export function act(name, ...args) { return actOn('click', name, ...args); }

/** Attribute that stops the listed event types from bubbling past the element. */
export function stop(...types) { return ` data-stop="${types.join(' ')}"`; }

/** Same as stop(), for an element created in code. */
export function stopOn(el, ...types) { el.dataset.stop = types.join(' '); return el; }

const TOKENS = {
  $value: el => el.value,
  $number: el => Number(el.value),
  $checked: el => el.checked,
  $open: el => el.open,
  $el: el => el,
};

function resolve(v, el, event) {
  if (typeof v === 'string') {
    if (v === '$event') return event;
    return Object.prototype.hasOwnProperty.call(TOKENS, v) ? TOKENS[v](el) : v;
  }
  if (Array.isArray(v)) return v.map(x => resolve(x, el, event));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = resolve(v[k], el, event);
    return out;
  }
  return v;
}

function argsFor(el, type) {
  const raw = el.getAttribute(`data-${type}-args`) ?? el.getAttribute('data-args');
  if (raw == null) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : [a]; } catch { return []; }
}

const NO_BUBBLE = new Set(['toggle']);

export function dispatch(type, event) {
  let el = event.target;
  if (el && el.nodeType !== 1) el = el.parentElement;
  const attr = `data-${type}`;
  const chain = [];
  for (; el; el = el.parentElement) {
    const name = el.getAttribute(attr);
    const stops = (el.getAttribute('data-stop') || '').split(/\s+/).includes(type);
    if (name != null || stops) chain.push({ el, name, stops });
    if (stops || NO_BUBBLE.has(type)) break;
  }
  for (const { el: node, name, stops } of chain) {
    if (name != null) {
      const fn = registry.get(name);
      if (!fn) { console.warn(`No action registered: ${name}`); }
      else {
        Object.defineProperty(event, 'currentTarget', { value: node, configurable: true });
        fn(...argsFor(node, type).map(a => resolve(a, node, event)));
      }
    }
    if (stops) { event.stopPropagation(); event.stopImmediatePropagation(); break; }
  }
}

const TYPES = ['click', 'dblclick', 'change', 'input', 'keydown', 'submit', 'dragstart', 'dragend', 'dragover',
  'dragleave', 'drop', 'pointerdown', 'mousedown', 'mousemove', 'focusin', 'focusout', 'toggle'];

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  for (const type of TYPES) document.addEventListener(type, e => dispatch(type, e), type === 'toggle');
}
