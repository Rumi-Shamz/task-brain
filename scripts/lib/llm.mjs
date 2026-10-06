/**
 * One entry point for "give me JSON matching this schema" across model providers.
 *
 *   LLM_PROVIDER=anthropic (default)  ANTHROPIC_API_KEY, LLM_MODEL (default claude-opus-5-5)
 *   LLM_PROVIDER=ollama               OLLAMA_HOST (default http://127.0.0.1:11434), LLM_MODEL (default qwen2.5:7b)
 *
 * Output is always re-checked with validate(); on failure the errors are sent back once for a repair.
 * Plain fetch keeps the repo free of dependencies (V2.md constraint 3).
 */
import { validate, schemaForModel, stripNulls } from './validate.mjs';

export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  ollama: 'qwen2.5:7b',
};

export function providerConfig(env = process.env) {
  const provider = (env.LLM_PROVIDER || 'anthropic').toLowerCase();
  if (!DEFAULT_MODELS[provider]) throw new Error(`Unknown LLM_PROVIDER "${provider}" (anthropic | ollama)`);
  return {
    provider,
    model: env.LLM_MODEL || DEFAULT_MODELS[provider],
    apiKey: env.ANTHROPIC_API_KEY || '',
    ollamaHost: (env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, ''),
  };
}

async function callAnthropic(cfg, { system, messages, schema }) {
  if (!cfg.apiKey) throw new Error('Set ANTHROPIC_API_KEY in the environment (never commit it).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // On a safety decline the API re-runs the request on a suitable fallback model.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 16000,
      system,
      messages,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      fallbacks: 'default',
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  if (body.stop_reason === 'refusal') {
    const d = body.stop_details || {};
    throw new Error(`Model declined (${d.category || 'no category'}): ${d.explanation || ''}`);
  }
  if (body.stop_reason === 'max_tokens') throw new Error('Output hit max_tokens; transcript too long for one pass.');
  return (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
}

async function callOllama(cfg, { system, messages, schema }) {
  const res = await fetch(`${cfg.ollamaHost}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      format: schema,
      options: { temperature: 0 },
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  return (body.message && body.message.content) || '';
}

const CALLERS = { anthropic: callAnthropic, ollama: callOllama };

/**
 * @returns {Promise<{ value: object, attempts: number, provider: string, model: string }>}
 */
export async function generateJson({ system, input, schema, cfg = providerConfig(), maxAttempts = 2 }) {
  const wire = schemaForModel(schema);
  const messages = [{ role: 'user', content: input }];
  let lastErrors = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await CALLERS[cfg.provider](cfg, { system, messages, schema: wire });
    let value = null;
    try { value = stripNulls(JSON.parse(text)); } catch (e) { lastErrors = ['response is not valid JSON']; }
    if (value) {
      lastErrors = validate(schema, value);
      if (!lastErrors.length) return { value, attempts: attempt, provider: cfg.provider, model: cfg.model };
    }
    messages.push({ role: 'assistant', content: text || '{}' });
    messages.push({
      role: 'user',
      content: `That JSON failed validation:\n- ${lastErrors.slice(0, 20).join('\n- ')}\nReturn the corrected JSON only.`,
    });
  }
  const err = new Error(`Model output failed schema validation:\n- ${lastErrors.join('\n- ')}`);
  err.validationErrors = lastErrors;
  throw err;
}
