# task-brain

Beta. Hosted day planner for use across devices. This month is for living with the current app and finding problems. The items under Planned are in scope after that, target end of November 2026.

Vanilla HTML/CSS/JS on GitHub Pages. No build step. Open https://rumi-shamz.github.io/task-brain/ on each device. Do not clone this repo to use the app, and do not put it on your GitHub account.

Your data lives in a **private GitHub repo you create**. The app reads and writes `data.json` there with a fine-grained PAT. The token stays in the browser on that device.

## What it does

- **01 Plan** — add tasks (one or bulk), triage (size, L/N/O, blocking, who is affected, subtasks), mark draining work and add recovery buffers, assign domain / project / activity (`research` | `communicate` | `act` | `learn`), schedule a slot or a batch, merge duplicate projects.
- **Import** — weekly plan from `.json`, `.csv`, or `.xlsx`. Bad rows are reported. Schema: `schema/plan.schema.json`.
- **02 Today** — day calendar (click to edit, drag to move, resize the bottom edge), domain board, inbox, someday review (delegate, convert, delete, or defer). A **next up** strip shows what is on now and the next three items with time left, refreshed every minute while open (no push notifications). **Delegated** lists tasks handed to a person or to the assistant; **Slipped** lists tasks whose day passed.
- **Who does it** — each task is for me, someone else (with a name), or the assistant (the note is the brief; it waits in Delegated until the assistant can run tasks).
- **03 Upskill** — skill backlog by utility × time-to-learn. `schedule` skills seed a weekly Learn block and reviews at +1, +7, and +30 days. Shows the share of scheduled minutes on L this week.
- **04 Year** — year / month / week, seasons, protocol blocks (sprint, vacation, fast, restore, deep rest), hour stats.
- **Recurring** (04 Year) — appointments (fixed time) and containers (time blocks tasks go into), each with a domain and project. Repeats weekly (every N weeks, chosen days), monthly (day N, or the 2nd / last weekday), yearly, or once, with start and end dates, optionally only on work days. Domain colors are editable and tint the calendars and board. **Import .ics** (e.g. a Google Calendar export; re-importing updates instead of duplicating) and **Export .ics**.
- **Sync** — on open, the app pulls `data.json` from the private repo before it can push, so one device cannot overwrite the other with stale data.

## Planned after this beta

- Voice session → transcript → validated week JSON in the private repo, plus a weekly prebrief.
- Supabase auth instead of a PAT.
- Inbox/email, Drive/Coda/Notion, search, classifiers, multi-user auth, Projects: KPI / OKR / budget.

Do not build these during the beta month unless the owner asks. Code tasks and constraints: `V2.md`.

## For a person

You need a GitHub account. You do not need this repository. Ask an agent that can use your machine and GitHub account to run the setup below, then open the site on your phone and your computer and connect the same private repo on each.

## For an agent setting this up

You are setting up a user. They already use https://rumi-shamz.github.io/task-brain/. Do not clone `task-brain` onto their account. Do not start a local server.

1. `gh auth status`. If it fails, run `gh auth login` and let the user finish the browser login.
2. Create a private data repo on **their** account. Any name except `task-brain` (the app rewrites that name). `task-brain-data` is fine.
   `gh repo create task-brain-data --private --confirm`
3. Open https://github.com/settings/personal-access-tokens/new and have the user create a fine-grained PAT: only that repo, **Contents: Read and write**. They copy the token once. Do not commit it, and do not put it in this app repo.
4. On each device they will use, open the Pages URL. Triple-tap **Day Planner**. Set **their** owner, **their** data repo, and the PAT. Leave the defaults (`Rumi-Shamz` / `task-brain-data`) only if this is that account. **Connect & pull**.
5. Confirm the sync line leaves "Local only" and a pull or first push succeeds. An empty repo is normal: **Push save** creates `data.json`.

Same owner, same repo, a PAT for that repo, on every device.


## Sync and conflicts

Every record in `data.json` carries `updatedAt`, and deletions leave short-lived tombstones. If another device saved first, the app merges record by record (the newer edit wins) instead of overwriting. Edits made offline are merged on the next open.

## Weekly loop (outside the browser)

1. Before the session: `node scripts/extract_week.mjs --prebrief-only --data data.json --week 2026-W42` writes `prebrief-2026-W42.md` (last week's done vs. planned, slipped tasks, hours by domain, % L, someday items due).
2. After the session: `node scripts/extract_week.mjs transcript.txt --data data.json --week 2026-W42` writes a validated `week-2026-W42.json`. Import it on **01 Plan**.
3. **Import accuracy** on 01 Plan counts tasks corrected or deleted by hand after each import. v2 is done at 0 for three weeks in a row.

Or run the **Extract week plan** GitHub Action: it reads `transcripts/week-<week>.txt` and `data.json` from the private data repo (`DATA_REPO_TOKEN` secret) and can commit the results to `weeks/` there.

Model: `ANTHROPIC_API_KEY` (default `claude-opus-5-5`), or a local model with `LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:7b`. Compare models with `node scripts/eval_extract.mjs --cases <dir>` (a case is `transcript.txt` + a hand-corrected `expected.json`; keep real cases in the private repo).

## Development

No build step and no dependencies. Serve the folder with any static server. Tests use Node's built-in runner:

```
node --test tests/*.test.mjs
```
