/**
 * Workers the desktop runner can hand work to. Each one brings its own login:
 *   claude  the Claude Code CLI, signed in with the owner's claude.ai plan (`claude auth status`).
 *           task-brain never sees or stores that login.
 *   ollama  a local model through Ollama's HTTP API. Nothing leaves the machine.
 *
 * Every worker returns { status: 'done' | 'failed' | 'deferred', output, error, model, usage }.
 * 'deferred' means "try again later" (plan usage limit, Ollama not running) and is not recorded as a run.
 */
import { spawn } from 'node:child_process';
import { AGENT_RULES } from '../../js/agent-core.js';

const CLAUDE_TOOLS = 'Read,Write,Edit,Glob,Grep,WebSearch,WebFetch';
const LIMIT_RE = /usage limit|rate limit|limit (reached|resets)|too many requests|overloaded|\b429\b|\b529\b/i;
const AUTH_RE = /not logged in|please run .*login|invalid api key|authentication|oauth token/i;

function runProcess(cmd, args, { cwd, timeoutMs, env, input }) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }, timeoutMs);
    child.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err.message || err), timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

/**
 * Claude Code in --print mode, locked down: --restricted removes the shell and confines the file
 * tools to the run folder, --strict-mcp-config loads no connectors (no Gmail, no Drive), and user
 * and project settings are ignored. It can read, write files in its folder, and search the web.
 */
export async function runClaude(prompt, { cwd, model, timeoutMs, bin = 'claude' }) {
  // The prompt goes in on stdin: a plan can be larger than one command-line argument may be.
  const args = [
    '-p',
    '--restricted', '--strict-mcp-config',
    '--tools', CLAUDE_TOOLS,
    // Pre-approve the tools: nobody is there to answer a permission prompt, so anything not allowed is denied.
    '--allowedTools', CLAUDE_TOOLS,
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
    '--no-session-persistence', '--output-format', 'json',
    '--append-system-prompt', AGENT_RULES,
  ];
  if (model) args.push('--model', model);
  const res = await runProcess(bin, args, { cwd, timeoutMs, env: process.env, input: prompt });
  if (res.timedOut) return { status: 'failed', error: `Stopped after ${Math.round(timeoutMs / 60000)} min`, model };
  let j = null;
  try { j = JSON.parse(res.stdout.trim().split('\n').pop()); } catch (e) { /* not JSON: CLI failed before the run */ }
  if (!j) {
    const msg = (res.stderr || res.stdout || `claude exited with ${res.code}`).trim().slice(0, 500);
    if (res.code === -1) return { status: 'failed', error: `Could not start claude: ${msg}`, model };
    return { status: LIMIT_RE.test(msg) ? 'deferred' : 'failed', error: msg, model };
  }
  const used = Object.keys(j.modelUsage || {}).filter(m => !/haiku/.test(m))[0] || model || 'claude';
  const usage = { costUsd: j.total_cost_usd ?? null, turns: j.num_turns ?? null, ms: j.duration_ms ?? null };
  if (j.is_error) {
    const msg = String(j.result || j.subtype || 'error').slice(0, 500);
    if (j.api_error_status === 429 || LIMIT_RE.test(msg)) return { status: 'deferred', error: msg, model: used };
    if (AUTH_RE.test(msg)) return { status: 'failed', error: `Claude login problem: ${msg}. Run \`claude auth status\` on the desktop.`, model: used };
    return { status: 'failed', error: msg, model: used, usage };
  }
  return { status: 'done', output: String(j.result || ''), model: used, usage };
}

/** Ollama chat, no tools: drafting, summarising, sorting. */
export async function runOllama(prompt, { host, model, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/chat`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, options: { num_ctx: 16384 },
        messages: [
          { role: 'system', content: `${AGENT_RULES}\n- You have no tools and no web access in this run: work from the brief and the plan only, and say so if that is not enough.\n- Do not mention files; you cannot write any.` },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return { status: res.status === 404 ? 'failed' : 'deferred', error: `Ollama ${res.status}: ${body}`, model };
    }
    const j = await res.json();
    const output = String((j.message && j.message.content) || '').trim();
    if (!output) return { status: 'failed', error: 'Empty reply', model };
    return { status: 'done', output, model, usage: { ms: j.total_duration ? Math.round(j.total_duration / 1e6) : null } };
  } catch (e) {
    if (e.name === 'AbortError') return { status: 'failed', error: `Stopped after ${Math.round(timeoutMs / 60000)} min`, model };
    // Connection refused: Ollama is not running right now. Try again on a later tick.
    return { status: 'deferred', error: `Ollama not reachable at ${host}: ${e.cause?.code || e.message}`, model };
  } finally {
    clearTimeout(timer);
  }
}
