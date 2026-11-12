import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportUrl, redact, recordError, recentErrors } from '../js/bug-report.js';

const ctx = {
  view: 'Act › Day',
  version: '20261112a',
  site: 'shijin.anastasov.eu',
  userAgent: 'Mozilla/5.0 (Android 15) Firefox/140.0',
  viewport: '390×844 @3x, touch',
  errors: [{ at: '09:15:02', msg: 'TypeError: x is undefined', n: 2 }],
};

test('the report opens a new issue on the public repo with the goblin label and the context', () => {
  const url = new URL(buildReportUrl(ctx));
  assert.equal(url.origin + url.pathname, 'https://github.com/Rumi-Shamz/task-brain/issues/new');
  assert.equal(url.searchParams.get('labels'), 'goblin');
  assert.equal(url.searchParams.get('title'), '[Act › Day] ');
  const body = url.searchParams.get('body');
  for (const part of ['- View: Act › Day', '- App version: 20261112a', '- Site: shijin.anastasov.eu',
    'Firefox/140.0', '390×844 @3x, touch', '09:15:02 TypeError: x is undefined (×2)', 'This repo is public']) {
    assert.ok(body.includes(part), `body has ${part}`);
  }
});

test('no errors says none, and the body stays short enough for a URL', () => {
  const body = new URL(buildReportUrl({ ...ctx, errors: [] })).searchParams.get('body');
  assert.match(body, /- Recent errors: none/);
  assert.doesNotMatch(body, /```/);
  const many = Array.from({ length: 40 }, (_, i) => ({ at: '10:00:00', msg: 'E'.repeat(300) + i, n: 1 }));
  assert.ok(buildReportUrl({ ...ctx, errors: many }).length < 8000);
});

test('redact removes tokens, the data repo, query strings, emails and backticks', () => {
  const out = redact('GET https://api.github.com/repos/alice/my-data/contents/data.json?ref=main 401 ' +
    'ghp_abcdefghijklmnopqrstuvwxyz012345 github_pat_11AAAAAAA0abcdefghijklmnop Bearer abc.def.ghi1234 ' +
    'mail me@example.com ```x```\n next line');
  assert.doesNotMatch(out, /alice|my-data|ref=main|ghp_|github_pat_|abc\.def|me@example\.com|`|\n/);
  assert.match(out, /api\.github\.com\/repos\/<owner>\/<repo>\/contents\/data\.json 401/);
  assert.ok(redact('x'.repeat(1000)).length <= 300);
});

test('recorded errors are redacted, repeats are counted, and only the last few are kept', () => {
  recordError(new TypeError('bad token ghp_abcdefghijklmnopqrstuvwxyz0123'));
  recordError(new TypeError('bad token ghp_abcdefghijklmnopqrstuvwxyz0123'));
  let list = recentErrors();
  assert.equal(list.at(-1).msg, 'TypeError: bad token [token]');
  assert.equal(list.at(-1).n, 2);
  for (let i = 0; i < 20; i++) recordError('error', i);
  list = recentErrors();
  assert.equal(list.length, 8);
  assert.equal(list.at(-1).msg, 'error 19');
});
