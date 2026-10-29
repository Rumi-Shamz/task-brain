# task-brain

Beta. Hosted day planner for use across devices. This month is for living with the current app and finding problems. The items under Planned are in scope after that, target end of November 2026.

Vanilla HTML/CSS/JS on GitHub Pages. No build step. Open https://shijin.anastasov.eu/ on each device (the old https://rumi-shamz.github.io/task-brain/ address redirects there). Do not clone this repo to use the app, and do not put it on your GitHub account.

Your data lives in a **private GitHub repo you create**. The app reads and writes `data.json` there with a fine-grained PAT. The token stays in the browser on that device.

## What it does

- **01 Organize** — add tasks (one or bulk), triage (size, L/N/O, blocking, who is affected, subtasks), mark draining work and add recovery buffers, assign domain / project / activity (`research` | `communicate` | `act` | `learn`), schedule a slot or a batch, merge duplicate projects.
- **Import** — weekly plan from `.json`, `.csv`, or `.xlsx`. Bad rows are reported. Schema: `schema/plan.schema.json`.
- **02 Act** — day calendar (click to edit, drag to move, resize the bottom edge, **⇥** beside the done box to defer a task to a day next week, +1 week / month / 3 months, a date, or the backlog; the weekly review lists deferred tasks apart from slipped ones), domain board, inbox, **Backlog** (every parked task by domain, with Schedule; items due for review first: delegate, next action, delete, or push the review). A **next up** strip shows what is on now and the next three items with time left, refreshed every minute while open (no push notifications). **Delegated** lists tasks handed to a person or to the assistant; **Slipped** lists tasks whose day passed. **Waits on** (in the edit sheet) locks a task until another is done: 🔒 on the board, left out of next up. Checking off a bigger task (size Mid/Complex, in a project, or something waits on it) asks for the outcome (result + note) and follow-ups, which wait on it; small tasks stay one click. The weekly review shows outcomes and what each task unlocked.
- **Who does it** — each task is for me, someone else (with a name), or the assistant. For the assistant, the note is the brief: pick **Claude** or **Local** (Ollama) and whether it may see your open plan. Results show in **Delegated**: accept (done, result kept in the note), run again with feedback, or take back.
- **Errands** (on 02 Act) — briefs the assistant runs on a schedule (weekly on chosen days, or monthly, at a time), each with its own results: mark seen, make a task from one, run now, pause.
- **03 Develop** — skill backlog by utility × time-to-learn. `schedule` skills seed a weekly Learn block and reviews at +1, +7, and +30 days. Shows the share of scheduled minutes on L this week.
- **04 Plan** — year / month / week, seasons, protocol blocks (sprint, vacation, fast, restore, deep rest), hour stats. Week shows one period at a time: the work week (Mon–Fri long season, Mon–Thu short) or the rest between (Fri noon–Mon noon, or Thu noon–Mon noon). Click a day in Year or Month to open its period; Prev/Next alternate work and rest.
- **Recurring** (04 Plan) — external events (set by others or imported from another calendar: fixed time, no tasks inside) and containers (your own time blocks that tasks go into), each with a domain and project. Repeats weekly (every N weeks, chosen days), monthly (day N, or the 2nd / last weekday), yearly, or once, with start and end dates, optionally only on work days. Domain colors are editable and tint the calendars and board. **Import .ics** (e.g. a Google Calendar export; re-importing updates instead of duplicating) and **Export .ics**.
- **Sync** — on open, the app pulls `data.json` from the private repo before it can push, so one device cannot overwrite the other with stale data.

## Planned after this beta

- Voice session → transcript → validated week JSON in the private repo, plus a weekly prebrief.
- Supabase auth instead of a PAT.
- Inbox/email, Drive/Coda/Notion, search, classifiers, multi-user auth, Projects: KPI / OKR / budget.

Do not build these during the beta month unless the owner asks. Code tasks and constraints: `V2.md`.

## For a person

You need a GitHub account. You do not need this repository. Ask an agent that can use your machine and GitHub account to run the setup below, then open the site on your phone and your computer and connect the same private repo on each.

## For an agent setting this up

You are setting up a user. They already use https://shijin.anastasov.eu/. Do not clone `task-brain` onto their account. Do not start a local server.

1. `gh auth status`. If it fails, run `gh auth login` and let the user finish the browser login.
2. Create a private data repo on **their** account. Any name except `task-brain` (the app rewrites that name). `task-brain-data` is fine.
   `gh repo create task-brain-data --private --confirm`
3. Open https://github.com/settings/personal-access-tokens/new and have the user create a fine-grained PAT: only that repo, **Contents: Read and write**. They copy the token once. Do not commit it, and do not put it in this app repo.
4. On each device they will use, open https://shijin.anastasov.eu/. Triple-tap **Day Planner**. Set **their** owner, **their** data repo, and the PAT. Leave the defaults (`Rumi-Shamz` / `task-brain-data`) only if this is that account. **Connect & pull**.
5. Confirm the sync line leaves "Local only" and a pull or first push succeeds. An empty repo is normal: **Push save** creates `data.json`.

Same owner, same repo, a PAT for that repo, on every device.


## Sync and conflicts

Every record in `data.json` carries `updatedAt`, and deletions leave short-lived tombstones. If another device saved first, the app merges record by record (the newer edit wins) instead of overwriting. Edits made offline are merged on the next open.

## Assistant runner (desktop)

The app cannot run agents: it is a static page, and no keys go in the browser. A small runner on an always-on desktop does the work.

- Every 5 minutes a systemd user timer runs `scripts/agent_runner.mjs`. It pulls a clone of the data repo, runs due work (open tasks for the assistant, errands whose time has come), and commits `agent/results.json`. The app reads that file and never writes it; the runner never edits `data.json`.
- **Claude** runs through the Claude Code CLI on the desktop, so it uses that machine's claude.ai login (your plan); task-brain never sees or stores it. Each run is locked down: no shell, no connectors (Gmail, Drive), file tools only inside its own run folder (`~/.local/share/task-brain-agent/runs/<id>`), plus web search. It drafts and researches; anything that would send, buy, or book comes back under "Needs your approval".
- **Local** runs on Ollama (`qwen2.5:7b` by default), with no tools: nothing leaves the machine.
- When the plan's usage limit is hit, or Ollama is down, the work stays queued and the panel says so; it retries on later ticks. Missed errand days (desktop off) are not caught up.
- The plan is shared only when you tick it: open tasks (name, domain, project, dates, first 300 characters of the note) and someday names.

Set up, on the desktop, from the checkout the service should run from (needs `node`, `gh auth login`, and `claude` signed in):

```bash
scripts/agent-runner/install.sh                 # timer + ~/.config/task-brain-agent/env (models, limits)
node scripts/agent_runner.mjs --dry-run         # what is due now
node scripts/agent_runner.mjs --status          # runner state and recent runs
journalctl --user -u task-brain-agent -f        # logs
scripts/agent-runner/install.sh --remove        # stop it
scripts/agent-runner/install.sh --staging       # second timer for task-brain-data-staging (own settings and clone)
```

Staging and production each get their own runner, so assistant work tried on staging runs against the staging data. Both use the same Claude plan, so staging tests count towards its limits.

## Weekly loop (outside the browser)

Replace `2026-W42` below with the ISO week you are planning (an example, not the current week).

1. Before the session: `node scripts/extract_week.mjs --prebrief-only --data data.json --week 2026-W42` writes `prebrief-2026-W42.md` (last week's done vs. planned, slipped tasks, hours by domain, % L, someday items due).
2. After the session: `node scripts/extract_week.mjs transcript.txt --data data.json --week 2026-W42` writes a validated `week-2026-W42.json`. Import it on **01 Organize**.
3. **Import accuracy** on 01 Organize counts tasks corrected or deleted by hand after each import. v2 is done at 0 for three weeks in a row.

The **Extract week plan** GitHub Action does the same in the cloud, but only for the repository's owner: it is wired to `Rumi-Shamz/task-brain-data` (read `transcripts/week-<week>.txt` and `data.json`, commit results to `weeks/`) and needs the `DATA_REPO_TOKEN` and `ANTHROPIC_API_KEY` secrets on this repo. It does not work against a different data repository; anyone else should run the script locally as above.

Model: `ANTHROPIC_API_KEY` (default `claude-opus-5-5`), or a local model with `LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:7b`. Compare models with `node scripts/eval_extract.mjs --cases <dir>` (a case is `transcript.txt` + a hand-corrected `expected.json`; keep real cases in the private repo).

## Testing changes before they go live

The live app (GitHub Pages) only changes when a PR merges to `main`. To try changes first:

- **On any device:** open the staging preview, https://task-brain-git-staging-rumi-shamzs-projects.vercel.app (the `staging` branch, kept at the newest unmerged work). Vercel previews ask for a Vercel login once per browser.
- **Your data in a preview:** the app picks its data repo from the address. The published site (`shijin.anastasov.eu`) syncs the real `task-brain-data`; staging, Vercel previews and localhost sync `task-brain-data-staging`, and refuse the real repo even if you type it. Test imports and new data versions there; nothing reaches the real data. Your token needs access to both repos.
- **Weekly extraction:** it runs on your computer, not in the app. `LLM_PROVIDER=ollama node scripts/extract_week.mjs transcript.txt --week 2026-W42 --out out/` (or with `ANTHROPIC_API_KEY`) writes `out/week-2026-W42.json`; import it on **01 Organize** and check the import report and **Import accuracy**. `--prebrief-only --data data.json` writes the prebrief without a model. The GitHub Action can only be started once its workflow is on `main`.

## Development

No build step and no dependencies. Serve the folder with any static server. Tests use Node's built-in runner:

```
node --test tests/*.test.mjs
```
