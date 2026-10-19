# Week plan CSV: rules for the planning assistant

Produce one CSV with exactly this header row, in this order:

```
Key word,Domain,Project,Priority,Timepressure,Allotted day,Allotted time,Start,Length,Size,Activity,LNO,Who,Parent,Description
```

One row per task. Leave a cell empty rather than guessing. Quote any cell that contains a comma.

| Column | Required | Allowed values | Notes |
|---|---|---|---|
| Key word | yes | short task name | 2–6 words, starts with a verb where possible |
| Domain | yes | `Dorst`, `Dev`, `ALFA`, `SwingShuffle`, `SwingSociety`, `Personal` | Exactly one of these |
| Project | yes | free text | Reuse the exact same project name for related tasks |
| Priority | yes | `0` `1` `2` `3` | 3 = highest |
| Timepressure | no | `urgent`, `important`, or empty | `urgent` marks the task as blocking |
| Allotted day | no | `monday` … `sunday` | Empty = unscheduled this week |
| Allotted time | no | `morning` (09:00), `afternoon` (13:00), `evening` (18:00) | Tasks in the same slot are stacked one after another |
| Start | no | `HH:MM`, e.g. `15:30` | Fixed time (meetings). Overrides Allotted time. Needs a day |
| Length | yes | `15`, `30`, `60`, `180` (minutes) | Other numbers snap to the nearest. Longer work: split into several rows |
| Size | yes | `simple`, `mid`, `complex` | Use this column, not `[middle]` tags in the description |
| Activity | yes | `research`, `communicate`, `act`, `learn` | |
| LNO | no | `L` (leverage), `N` (neutral), `O` (optional) | |
| Who | no | `me`, `assistant`, `local`, or a person's name | Empty = me. See below |
| Parent | no | the Key word of another row | Makes this row a subtask of that one. See below |
| Description | no | free text | The note on the task. For assistant tasks this is the brief |

## Who

- `me`: I do it.
- A name (`Anna`): delegated to that person; I follow up.
- `assistant`: Claude does it unattended on my desktop, with web search, and can write files. It **cannot** send, book, buy or contact anyone; it prepares drafts and lists anything that needs my approval. Use it for research, comparisons, drafts, checklists and summaries.
- `local`: a small local model with no internet. Only for drafting or summarising text that is fully contained in the description.

For `assistant` and `local` rows the Description is the whole brief: say what to produce, for whom, how long, and what "done" looks like. Leave Allotted day and time empty; the assistant starts within minutes of import.

## Grouping related work

- Tasks that belong together get the **exact same Project** text.
- Work split into steps or sessions: add one umbrella row (no day, no time) and give each step that umbrella's Key word in **Parent**. Example: `Launch personal website` with `Review personal website` and `Ship personal website` as its subtasks.
- A Key word should appear only once in the file. Two sessions of the same work get distinct names (`Product cost analysis 1`, `Product cost analysis 2`) under one parent.

## Do not

- Do not put times or sizes inside the Description (`At 15:30 —`, `[middle]`); use Start and Size.
- Do not set an Allotted time without an Allotted day; the time is ignored.
- Do not invent new Domain names.
- Do not add columns or change the header.
