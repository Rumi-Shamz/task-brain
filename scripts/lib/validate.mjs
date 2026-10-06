/**
 * Minimal JSON Schema checker for the subset used in schema/*.json
 * (type, enum, const, required, properties, additionalProperties:false, items,
 * $ref to #/$defs, minimum/maximum, minLength, pattern). No dependencies.
 */

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((o, k) => o && o[k], root);
}

function typeOk(type, v) {
  if (type === 'integer') return Number.isInteger(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (type === 'null') return v === null;
  return typeof v === type;
}

/** @returns {string[]} error messages with JSON-pointer-ish paths; empty when valid */
export function validate(schema, value, root = schema, path = '') {
  if (schema.$ref) return validate(resolveRef(root, schema.$ref), value, root, path);
  const errs = [];
  const at = path || '/';
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => typeOk(t, value))) return [`${at}: expected ${types.join('|')}`];
  }
  if (schema.const !== undefined && value !== schema.const) errs.push(`${at}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errs.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errs.push(`${at}: above ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${at}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errs.push(...validate(schema.items, v, root, `${path}/${i}`)));
  }
  if (typeOk('object', value)) {
    (schema.required || []).forEach(k => {
      if (!(k in value)) errs.push(`${at}: missing ${k}`);
    });
    const props = schema.properties || {};
    Object.keys(value).forEach(k => {
      if (props[k]) errs.push(...validate(props[k], value[k], root, `${path}/${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}: unexpected ${k}`);
    });
  }
  return errs;
}

const UNSUPPORTED_FOR_STRUCTURED_OUTPUT = ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'multipleOf'];

/**
 * Schema to send to a model: $refs inlined, metadata dropped, and constraints the
 * providers' constrained decoders reject removed (they are re-checked by validate()).
 * Optional properties become required-but-nullable: decoders otherwise let small models
 * stop after the first few fields. stripNulls() undoes this on the response.
 */
export function schemaForModel(schema, root = schema) {
  if (Array.isArray(schema)) return schema.map(s => schemaForModel(s, root));
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) return schemaForModel(resolveRef(root, schema.$ref), root);
  const out = {};
  Object.entries(schema).forEach(([k, v]) => {
    if (k === '$defs' || k === '$schema' || k === '$id' || k === 'title') return;
    if (UNSUPPORTED_FOR_STRUCTURED_OUTPUT.includes(k)) return;
    if (k === 'const') { out.enum = [v]; return; }
    out[k] = k === 'properties'
      ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, schemaForModel(pv, root)]))
      : schemaForModel(v, root);
  });
  if (out.properties) {
    const required = new Set(out.required || []);
    Object.keys(out.properties).forEach(k => {
      if (!required.has(k)) out.properties[k] = { anyOf: [out.properties[k], { type: 'null' }] };
    });
    out.required = Object.keys(out.properties);
  }
  return out;
}

/** Drop null and empty-string object keys (the "not stated" answers to a nullable field). */
export function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.entries(value).forEach(([k, v]) => { if (v !== null && v !== '') out[k] = stripNulls(v); });
  return out;
}
