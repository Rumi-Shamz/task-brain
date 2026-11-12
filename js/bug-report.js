// "Report a bug": opens a prefilled new-issue page on the app's public GitHub repo.
// No token and no data leave the page by themselves: the reporter sees the issue form, can edit it,
// and submits it with their own GitHub login. Only the view, app version, site, browser, viewport and
// the last few error messages (redacted) are filled in. Nothing from data.json, ever.
//
// The `goblin` label in the URL is applied only when the reporter has triage rights on the repo (the
// owner). For anyone else GitHub drops it, so a stranger's report never reaches the pr-goblin runner.

export const REPORT_REPO = 'Rumi-Shamz/task-brain';
export const REPORT_LABEL = 'goblin';

const MAX_ERRORS = 8;
const MAX_ERROR_LEN = 300;
// GitHub refuses very long new-issue URLs; stay well under its limit.
const MAX_BODY_LEN = 5000;

const recent = [];

/** One line, short, and with anything that could identify the user or their data repo taken out. */
export function redact(text) {
  return String(text)
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g, '[token]')
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._\-]{8,}/gi, '$1 [token]')
    .replace(/(api\.github\.com\/repos|github\.com|raw\.githubusercontent\.com)\/[^/\s"')]+\/[^/\s"')]+/gi, '$1/<owner>/<repo>')
    .replace(/(https?:\/\/[^\s?#"')]+)[?#][^\s"')]*/g, '$1')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_LEN);
}

export function recordError(...parts) {
  const msg = redact(parts.map(p => (p instanceof Error ? `${p.name}: ${p.message}` : typeof p === 'string' ? p : safeJson(p))).join(' '));
  if (!msg) return;
  if (recent.length && recent[recent.length - 1].msg === msg) { recent[recent.length - 1].n++; return; }
  recent.push({ at: new Date().toISOString().slice(11, 19), msg, n: 1 });
  if (recent.length > MAX_ERRORS) recent.shift();
}

export function recentErrors() { return recent.map(e => ({ ...e })); }

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** The new-issue URL for a report. `ctx` is plain data so this can be tested without a browser. */
export function buildReportUrl(ctx) {
  const view = ctx.view || 'unknown view';
  const errors = ctx.errors || [];
  const lines = [
    '**What happened**', '', '',
    '**What I expected**', '', '',
    '**Steps to reproduce**', '1. ', '',
    '---',
    '_Added by the app. This repo is public: check this holds nothing private before submitting._',
    '',
    `- View: ${view}`,
    `- App version: ${ctx.version || 'unknown'}`,
    `- Site: ${ctx.site || 'unknown'}`,
    `- Browser: ${ctx.userAgent || 'unknown'}`,
    `- Viewport: ${ctx.viewport || 'unknown'}`,
    `- Recent errors: ${errors.length ? '' : 'none'}`,
  ];
  if (errors.length) {
    lines.push('```text');
    for (const e of errors) lines.push(`${e.at} ${e.msg}${e.n > 1 ? ` (×${e.n})` : ''}`);
    lines.push('```');
  }
  let body = lines.join('\n');
  if (body.length > MAX_BODY_LEN) body = body.slice(0, MAX_BODY_LEN - 4) + '\n```';
  const params = new URLSearchParams({ title: `[${view}] `, body, labels: ctx.label ?? REPORT_LABEL });
  return `https://github.com/${ctx.repo || REPORT_REPO}/issues/new?${params}`;
}

function currentView() {
  const tab = document.querySelector('.phase-tab.active');
  const parts = [tab ? tab.textContent.replace(/[^\p{L}\p{N} ]/gu, '').trim() : ''];
  const panel = document.querySelector('.phase.active');
  const sub = panel?.querySelector('.dash-m-tab.active, .year-view-toggle .btn.active');
  if (sub && sub.offsetParent !== null) parts.push(sub.textContent.trim());
  return parts.filter(Boolean).join(' › ');
}

function appVersion() {
  const src = document.querySelector('script[src*="js/app.js"]')?.getAttribute('src') || '';
  return new URLSearchParams(src.split('?')[1] || '').get('v') || '';
}

function currentContext() {
  const dpr = window.devicePixelRatio || 1;
  const touch = navigator.maxTouchPoints > 0 ? ', touch' : '';
  return {
    view: currentView(),
    version: appVersion(),
    site: location.host || location.protocol,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight} @${Math.round(dpr * 100) / 100}x${touch}`,
    errors: recentErrors(),
  };
}

function captureErrors() {
  window.addEventListener('error', e => recordError(e.error || e.message || 'error'));
  window.addEventListener('unhandledrejection', e => recordError('Unhandled rejection:', e.reason ?? ''));
  const original = console.error.bind(console);
  console.error = (...args) => { try { recordError(...args); } catch { /* never break logging */ } original(...args); };
}

// Installed on import: app.js imports this module first, so errors from the modules after it are kept too.
if (typeof window !== 'undefined' && typeof document !== 'undefined') captureErrors();

/** Point the footer link at a prefilled issue. Call once the page is up. */
export function initBugReport() {
  const link = document.getElementById('report-bug');
  if (!link) return;
  // Build the URL at click time so it carries the view and errors as they are now.
  const refresh = () => { link.href = buildReportUrl(currentContext()); };
  link.addEventListener('click', refresh);
  link.addEventListener('auxclick', refresh);
  link.addEventListener('contextmenu', refresh);
}
