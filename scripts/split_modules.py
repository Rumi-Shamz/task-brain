#!/usr/bin/env python3
"""One-shot splitter: monolith index.html -> ES modules. Run from repo root."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'index.html').read_text()

style_open = html.index('<style>') + len('<style>')
style_close = html.index('</style>')
css = html[style_open:style_close].lstrip('\n')
if not css.endswith('\n'):
    css += '\n'
(ROOT / 'styles.css').write_text(css)

body_inner_start = html.index('<body>') + len('<body>')
sheet_idx = html.index('<script src="https://cdn.sheetjs.com')
body_html = html[body_inner_start:sheet_idx].strip('\n') + '\n'
sheetjs = html[sheet_idx:html.index('</script>', sheet_idx) + len('</script>')] + '\n'

script_open = html.rindex('<script>\n') + len('<script>\n')
script_close = html.rindex('</script>')
raw_js = html[script_open:script_close]
lines = [(l[2:] if l.startswith('  ') else l).rstrip('\n') for l in raw_js.splitlines(True)]


def find_line(prefix):
    for i, l in enumerate(lines):
        if l.startswith(prefix):
            return i
    raise SystemExit(f'missing {prefix!r}')


ranges = {
    'state_helpers': (0, find_line('function save()')),
    'storage': (find_line('function save()'), find_line('/* ---------- GitHub data.json sync')),
    'sync': (find_line('/* ---------- GitHub data.json sync'), find_line('/* ---------- Weekly plan import')),
    'triage': (find_line('/* ---------- Weekly plan import'), find_line('function renderOrganize()')),
    'organize': (find_line('function renderOrganize()'), find_line('function renderSchedule()')),
    'schedule': (find_line('function renderSchedule()'), find_line('function setYearAnchor(value)')),
    'year': (find_line('function setYearAnchor(value)'), find_line('function renderDayCalendar()')),
    'dashboard': (find_line('function renderDayCalendar()'), find_line('function switchPhase(phase)')),
    'ui_rest': (find_line('function switchPhase(phase)'), find_line('load();')),
    'boot': (find_line('load();'), len(lines)),
}

STATE_VARS = [
    'tasks', 'groups', 'groupCounter', 'schedule', 'dragSrc', 'yearRhythm', 'yearHourLogs',
    'yearCalendarView', 'yearWeekMonday', 'yearMonthCursor', 'yearSelectedLogId', 'yearHourDrag',
    'dashDragId', 'calPointer', 'dashCalDate', 'hideDone', 'timerTickId', 'customProjects',
    'dayCalScrolledOnce', 'yearWeekScrolledOnce', 'ghPushTimer', 'fileSha', 'ghSaving',
]
STATE_SET = set(STATE_VARS)
CALL_FNS = [
    'save', 'render', 'switchPhase', 'renderDashboard', 'renderYear', 'renderOrganize',
    'renderSchedule', 'renderDayCalendar', 'renderProjectBoard', 'ensureYearWeekMonday',
]


def slice_lines(a, b):
    return '\n'.join(lines[a:b]) + '\n'


def _replace_idents(expr, mapping, *, skip_object_keys=True):
    """Replace identifiers using mapping, skipping quotes and object keys. Templates: rewrite ${}."""
    out = []
    i = 0
    n = len(expr)

    def read_string(q, start):
        j = start + 1
        while j < n:
            if expr[j] == '\\':
                j += 2
                continue
            if expr[j] == q:
                return j + 1
            j += 1
        return n

    while i < n:
        ch = expr[i]
        if ch in ("'", '"'):
            j = read_string(ch, i)
            out.append(expr[i:j])
            i = j
            continue
        if ch == '`':
            out.append('`')
            i += 1
            while i < n:
                if expr[i] == '\\':
                    out.append(expr[i:i + 2])
                    i += 2
                    continue
                if expr[i] == '`':
                    out.append('`')
                    i += 1
                    break
                if expr[i] == '$' and i + 1 < n and expr[i + 1] == '{':
                    depth = 1
                    k = i + 2
                    while k < n and depth:
                        if expr[k] in ("'", '"'):
                            k = read_string(expr[k], k)
                            continue
                        if expr[k] == '{':
                            depth += 1
                        elif expr[k] == '}':
                            depth -= 1
                        k += 1
                    inner = expr[i + 2:k - 1]
                    out.append('${' + _replace_idents(inner, mapping, skip_object_keys=skip_object_keys) + '}')
                    i = k
                    continue
                out.append(expr[i])
                i += 1
            continue
        if ch.isalpha() or ch in '_$':
            j = i + 1
            while j < n and (expr[j].isalnum() or expr[j] in '_$'):
                j += 1
            word = expr[i:j]
            prev = ''.join(out).rstrip()
            if prev.endswith('.') and not prev.endswith('...'):
                out.append(word)
            elif skip_object_keys:
                k = j
                while k < n and expr[k].isspace():
                    k += 1
                if k < n and expr[k] == ':':
                    out.append(word)
                else:
                    out.append(mapping.get(word, word))
            else:
                out.append(mapping.get(word, word))
            i = j
            continue
        out.append(ch)
        i += 1
    return ''.join(out)


def rewrite_expr(expr, *, calls):
    mapping = {name: f'state.{name}' for name in STATE_VARS}
    out = _replace_idents(expr, mapping, skip_object_keys=True)
    out = out.replace('state.state.', 'state.')
    if calls:
        for fn in CALL_FNS:
            out = re.sub(rf'(?<![\w.$]){fn}\(', f'deps.{fn}(', out)
            out = out.replace(f'function deps.{fn}(', f'function {fn}(')
            out = out.replace(f'export function deps.{fn}(', f'export function {fn}(')
    return out


def rewrite_code(code, *, calls=True):
    out_lines = []
    for line in code.splitlines():
        stripped = line.lstrip()
        if re.match(r'(export\s+)?(let|const|var)\s+', stripped):
            m = re.match(r'^(\s*(?:export\s+)?(?:let|const|var)\s+)([\w$]+)(\s*=\s*)(.*)$', line)
            if m:
                name, rhs = m.group(2), m.group(4)
                if name in STATE_SET:
                    # Drop re-declarations of state fields (let fileSha = null)
                    continue
                rhs2 = rewrite_expr(rhs, calls=calls)
                out_lines.append(f'{m.group(1)}{name}{m.group(3)}{rhs2}')
                continue
        if re.match(r'^\s*(?:export\s+)?function\s+', line):
            out_lines.append(line)
            continue
        out_lines.append(rewrite_expr(line, calls=calls))
    return '\n'.join(out_lines) + '\n'


def fix_object_shorthand(code):
    """Expand `{ tasks, groups }` style shorthand after state. rewrite."""
    def repl_obj(m):
        body = m.group(1)
        # Skip if it looks like a block (has keywords) — only simple objects
        if 'return ' in body or 'if ' in body or 'const ' in body:
            return m.group(0)
        parts, depth, cur = [], 0, ''
        for ch in body:
            if ch in '[{(':
                depth += 1
            elif ch in ']})':
                depth -= 1
            if ch == ',' and depth == 0:
                parts.append(cur.strip())
                cur = ''
            else:
                cur += ch
        if cur.strip():
            parts.append(cur.strip())
        fixed = []
        for p in parts:
            m2 = re.fullmatch(r'state\.(\w+)', p)
            if m2:
                fixed.append(f'{m2.group(1)}: state.{m2.group(1)}')
            else:
                fixed.append(p)
        return '{ ' + ', '.join(fixed) + ' }'

    return re.sub(r'\{([^{}]+)\}', repl_obj, code)


def add_exports(code):
    out = []
    for line in code.splitlines():
        if line.startswith('function ') or line.startswith('async function ') or (
            line.startswith('const ') and '=' in line
        ):
            out.append('export ' + line)
        else:
            out.append(line)
    return '\n'.join(out) + '\n'


def strip_window(code):
    return re.sub(r'^window\.\w+ = .+\n', '', code, flags=re.M)


js_dir = ROOT / 'js'
js_dir.mkdir(exist_ok=True)

# --- state.js ---
sh = lines[ranges['state_helpers'][0]:ranges['state_helpers'][1]]
state_fields = {}
i = 0
while i < len(sh):
    line = sh[i]
    if not line.startswith('let '):
        break
    block = line
    j = i
    while True:
        codepart = re.sub(r'//.*', '', block)
        if (
            codepart.count('[') <= codepart.count(']')
            and codepart.count('{') <= codepart.count('}')
            and codepart.count('(') <= codepart.count(')')
            and codepart.rstrip().endswith(';')
        ):
            break
        j += 1
        if j >= len(sh):
            break
        block += '\n' + sh[j]
    m = re.match(r'let (\w+)\s*=\s*(.*)$', block, re.S)
    name, val = m.group(1), m.group(2).rstrip()
    # Value ends at first semicolon (ignore trailing comments)
    if ';' in val:
        val = val.split(';', 1)[0].rstrip()
    state_fields[name] = val
    i = j + 1
helper_start = i
for name, val in [('ghPushTimer', 'null'), ('fileSha', 'null'), ('ghSaving', 'false')]:
    state_fields.setdefault(name, val)

helpers = '\n'.join(sh[helper_start:]) + '\n'
helpers = rewrite_code(helpers, calls=False)
helpers = add_exports(helpers)
helpers = strip_window(helpers)
helpers = fix_object_shorthand(helpers)

state_parts = ['// Shared mutable app state\n', 'export const state = {\n']
for name, val in state_fields.items():
    if '\n' in val:
        indented = val.replace('\n', '\n  ')
        state_parts.append(f'  {name}: {indented},\n')
    else:
        state_parts.append(f'  {name}: {val},\n')
state_parts.append('};\n\n')
state_parts.append(helpers)
state_text = ''.join(state_parts)
state_text = re.sub(
    r'export function workWindowFromMonth\(monthIndex, schedule\) \{[\s\S]*?\n\}',
    "export function workWindowFromMonth(monthIndex, schedule) {\n"
    "  return schedule.short.months.includes(monthIndex) ? 'short' : 'long';\n}",
    state_text,
    count=1,
)
state_text = re.sub(
    r'export function seasonSpec\(schedule, window\) \{[\s\S]*?\n\}',
    'export function seasonSpec(schedule, window) {\n'
    '  return (schedule || defaultWorkSchedule())[window];\n}',
    state_text,
    count=1,
)
state_text = re.sub(
    r'return \{ \.\.\.(?:state\.)?yearRhythm, hourLogs: state\.yearHourLogs \};',
    'return { ...state.yearRhythm, hourLogs: state.yearHourLogs };',
    state_text,
)
(js_dir / 'state.js').write_text(state_text)


def make_module(range_key, imports, *, calls=True, post=None):
    chunk = slice_lines(*ranges[range_key])
    chunk = rewrite_code(chunk, calls=calls)
    chunk = strip_window(chunk)
    chunk = add_exports(chunk)
    chunk = fix_object_shorthand(chunk)
    if post:
        chunk = post(chunk)
    return imports + '\n' + chunk


storage = make_module(
    'storage',
    "import {\n  state, normalizeTask, normalizeRhythm, normalizeHourLogs,\n"
    "  normalizeCustomProjects, normalizeWorkSchedule, seedYearRhythm, rhythmWithHours,\n"
    "} from './state.js';\n",
    calls=False,
)
(js_dir / 'storage.js').write_text(storage)


def sync_post(c):
    c = re.sub(r'// Triple-tap logo[\s\S]*?\}\)\(\);\n*', '', c)
    c += """
export function bindLogoSync() {
  let taps = 0, last = 0;
  document.addEventListener('click', e => {
    const logo = e.target.closest('#app-logo');
    if (!logo) return;
    const now = Date.now();
    taps = (now - last < 550) ? taps + 1 : 1;
    last = now;
    if (taps >= 3) { taps = 0; toggleSyncPanel(); }
  });
}
"""
    return c


sync = make_module(
    'sync',
    "import { state } from './state.js';\n"
    "import { getPersistPayload, applyPersistPayload } from './storage.js';\n"
    "import { deps } from './deps.js';\n",
    post=sync_post,
)
(js_dir / 'sync.js').write_text(sync)


def triage_post(c):
    c = re.sub(r'\nexport function render\(\) \{[\s\S]*?\n\}\n', '\n', c, count=1)
    if 'export const setWho' not in c:
        c += '\nexport const setWho = updateWho;\n'
    return c


triage = make_module(
    'triage',
    "import {\n  state, BUILTIN_PROJECTS, PROJECT_PALETTE, DEFAULT_DURATION,\n"
    "  slugProjectId, isBuiltinProject, allProjects, newTask,\n"
    "  dateForDay, mondayOfWeek, mondayOnOrBefore, addDaysLocal,\n"
    "  formatYmd, parseYmd, formatHHMM, chipControlsHTML, projectClass,\n"
    "  setHideDone, toggleTaskDone, startTaskTimer, pauseTaskTimer, stopTaskTimer,\n"
    "} from './state.js';\nimport { deps } from './deps.js';\n",
    post=triage_post,
)
(js_dir / 'triage.js').write_text(triage)

organize = make_module(
    'organize',
    "import { state, esc, chipControlsHTML } from './state.js';\nimport { deps } from './deps.js';\n",
)
(js_dir / 'organize.js').write_text(organize)

schedule = make_module(
    'schedule',
    "import { state, BUFFERS, esc } from './state.js';\nimport { deps } from './deps.js';\n",
)
(js_dir / 'schedule.js').write_text(schedule)

year = make_module(
    'year',
    """import {
  state, YEAR_DAYS, FAST_DAYS, RESTORE_DAYS, SPRINT_DAYS, CYCLE_DAYS, DEEP_REST_DAYS, VACATION_DAYS,
  HOUR_H, WEEK_COL_H, VIEW_SCROLL_TOP, VIEW_HOUR_START, VIEW_HOUR_END, DAY_START_MIN, DAY_END_MIN,
  VISIBLE_MINUTES, SLOT_MINUTES, WEEKDAY_SHORT, MONTH_SHORT_WS, DEFAULT_DURATION,
  seedYearRhythm, normalizeRhythm, paintYear, dateForDay, mondayOfWeek, clampDay, weekdayOfDay,
  dayIndexToday, formatYmd, parseYmd, addDaysLocal, mondayOnOrBefore, formatClock, hoursBetween,
  snapMin, clampVisibleMin, defaultWorkSchedule, normalizeWorkSchedule, workWindowFromMonth,
  seasonSpec, hourLabel, monthsLabel, workWindowLabel, workWindowRuleText, seasonalWorkShadeRange,
  statsBuckets, newHourLogId, formatHHMM, parseHHMM, snapCalMins, clampCalStart,
  CAL_DAY_START, CAL_DAY_END, CAL_MIN_DURATION, projectClass, projectColStyleAttr,
  chipControlsHTML, esc, allProjects, LANES
} from './state.js';
import { deps } from './deps.js';
""",
)
(js_dir / 'year.js').write_text(year)

dashboard = make_module(
    'dashboard',
    """import {
  state, LANES, HOUR_H, VIEW_HOUR_START, VIEW_HOUR_END, VIEW_HOURS, VIEW_SCROLL_TOP,
  DAY_START_MIN, DAY_END_MIN, VISIBLE_MINUTES, DEFAULT_DURATION, CAL_DAY_START, CAL_DAY_END,
  CAL_SNAP, CAL_MIN_DURATION, allProjects, projectClass, projectColStyleAttr, chipControlsHTML,
  esc, formatYmd, parseYmd, parseHHMM, formatHHMM, snapCalMins, clampCalStart, todayYmd,
  ensureDashCalDate, formatTracked, taskElapsedMs, setHideDone, toggleTaskDone,
  startTaskTimer, pauseTaskTimer, stopTaskTimer
} from './state.js';
import { deps } from './deps.js';
""",
)
(js_dir / 'dashboard.js').write_text(dashboard)

triage_src = slice_lines(*ranges['triage'])
m = re.search(r'function render\(\) \{([\s\S]*?)\n\}\n\nfunction renderTriage', triage_src)
render_body = rewrite_code(m.group(1), calls=False).rstrip()

ui_rest = make_module(
    'ui_rest',
    "import { state } from './state.js';\n",
)
ui_fns = []
capture = False
for line in ui_rest.splitlines():
    if line.startswith('export function') or line.startswith('function'):
        capture = True
    if capture:
        ui_fns.append(line)
ui = f"""import {{ state }} from './state.js';
import {{ deps }} from './deps.js';
import {{ renderTriage }} from './triage.js';
import {{ renderOrganize }} from './organize.js';
import {{ renderSchedule }} from './schedule.js';
import {{ renderYear, ensureYearWeekMonday }} from './year.js';
import {{ renderDashboard }} from './dashboard.js';

export function render() {{
{render_body}
}}

""" + '\n'.join(ui_fns) + '\n'
for a, b in [
    ('deps.renderOrganize(', 'renderOrganize('),
    ('deps.renderSchedule(', 'renderSchedule('),
    ('deps.renderYear(', 'renderYear('),
    ('deps.renderDashboard(', 'renderDashboard('),
    ('deps.ensureYearWeekMonday(', 'ensureYearWeekMonday('),
    ('deps.render(', 'render('),
]:
    ui = ui.replace(a, b)
(js_dir / 'ui.js').write_text(ui)

(js_dir / 'deps.js').write_text(
    """export const deps = {
  save() {},
  render() {},
  switchPhase() {},
  renderDashboard() {},
  renderYear() {},
  renderDayCalendar() {},
  renderProjectBoard() {},
  renderOrganize() {},
  renderSchedule() {},
  ensureYearWeekMonday() {},
};
"""
)

boot = rewrite_code(slice_lines(*ranges['boot']), calls=False)
app = f'''import {{ state, addCustomProject, ensureTimerTick, setHideDone, toggleTaskDone, startTaskTimer, pauseTaskTimer, stopTaskTimer }} from './state.js';
import {{ save, load }} from './storage.js';
import {{
  ghConnect, ghPull, ghPush, ghDisconnect, toggleSyncPanel, refreshSyncForm, ghConnected, bindLogoSync
}} from './sync.js';
import * as triage from './triage.js';
import * as organize from './organize.js';
import * as schedule from './schedule.js';
import * as year from './year.js';
import * as dashboard from './dashboard.js';
import {{ render, switchPhase, clearAll }} from './ui.js';
import {{ deps }} from './deps.js';

deps.save = save;
deps.render = render;
deps.switchPhase = switchPhase;
deps.renderDashboard = dashboard.renderDashboard;
deps.renderYear = year.renderYear;
deps.ensureYearWeekMonday = year.ensureYearWeekMonday;
deps.renderOrganize = organize.renderOrganize;
deps.renderSchedule = schedule.renderSchedule;
deps.renderDayCalendar = dashboard.renderDayCalendar;
deps.renderProjectBoard = dashboard.renderProjectBoard;

Object.assign(window, triage, organize, schedule, year, dashboard, {{
  switchPhase,
  clearAll,
  render,
  addCustomProject,
  setHideDone,
  toggleTaskDone,
  startTaskTimer,
  pauseTaskTimer,
  stopTaskTimer,
  ghConnect,
  ghPull,
  ghPush: () => {{ clearTimeout(state.ghPushTimer); return ghPush({{ quiet: false }}); }},
  ghDisconnect,
  toggleSyncPanel,
}});

bindLogoSync();

{boot}
'''
(js_dir / 'app.js').write_text(app)

(ROOT / 'index.html').write_text(
    f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Day Planner</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
{body_html}
{sheetjs}<script type="module" src="js/app.js"></script>
</body>
</html>
'''
)

bad = False
for p in sorted(js_dir.glob('*.js')):
    r = subprocess.run(['node', '--check', str(p)], capture_output=True, text=True)
    n = len(p.read_text().splitlines())
    if r.returncode != 0:
        bad = True
        err = r.stderr.strip().splitlines()[0] if r.stderr else 'error'
        print('FAIL', p.name, err)
    else:
        print(('BIG' if n > 400 else 'OK  '), p.name, n)
if bad:
    sys.exit(1)
print('all syntax ok')
