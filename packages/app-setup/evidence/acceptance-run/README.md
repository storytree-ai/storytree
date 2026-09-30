# App setup: model user acceptance that writes verified health (increment_6886226fcbde, ADR-0825 D5)

A model drives the product as a first user would, and the harness, never the model, mints each contract's
verdict from what it observed. `pnpm record:acceptance <observations.json>` writes the verdicts to the verified
column as "acceptance run", with the commit and this evidence path (packages/dev-loop/src/acceptance-health.mjs,
dev loop contract 5.5).

## The journey (harness/)

- `journey.ps1` runs in the owner's desktop session on the Windows test laptop (process_81a7122f6849), started
  by `run-task.ps1`, a one-shot interactive scheduled task that it always deletes. For each of two fresh
  folders, one after the other: the installed `storytree doctor` from a fresh PowerShell; then a new Claude Code
  session (`claude -p`, storytree's tools allowed, nothing else) asked "I'd like to build a small to-do list web
  page in this folder, and I want storytree to keep its plan. Please set storytree up for this folder, as the
  project <name> …"; then `storytree doctor` again, its exit code, and where a fresh PowerShell finds the command.
  At the end, where Claude Code's registration starts storytree's tool server, and the app's version.
- `observe.mjs` turns those raw outputs into checks. It reads only what storytree's installed command and the
  machine said; the model's replies (`claude-*.txt`) are kept as evidence and never read. A clause the journey
  does not exercise is written as not observed, so its contract is left not checked. It voids the run if the app
  updated during it.

## Run of 2026-10-01 (2026-10-01/)

Laptop `micksoldlaptop`, Windows 11 x64, no Git and no Node on the path; storytree 0.3.401 (built from
931071cf9c7b), which the app had updated itself to from 0.3.400 minutes before the run; Claude Code signed in.

| Contract | Verdict | What the harness saw |
|---|---|---|
| 2.2 a new session in the folder, and later in another, reaches that folder's setup check | **passing, 6/6** | In each folder: not a project before; after one session, `storytree doctor` names the project the session was asked for; Claude Code's hooks reached storytree after the run started. |
| 1.5 after an update the next session starts compatible tools from a durable place | **passing, 4/4** | The app had just taken 0.3.400 → 0.3.401; with no Node and no Git on the path both sessions' tools set their folder up; Claude Code starts the tool server from the installed app's own `resources\agent-tools`. |
| 1.6 the command runs from a fresh terminal; an existing one is preserved | not checked (nothing written) | A fresh PowerShell finds `~\.storytree\0.3\bin\storytree.cmd` and doctor exits 0 in both folders, but an existing unrelated `storytree` command was not provoked. |

An earlier run that day (stamp 1001) is not kept: its exit-code capture was broken by PowerShell 5.1 stripping
quotes (process step 6), so it was fixed and run again.

Both sessions said the file-edit hook stayed unconfirmed because they were not allowed to write their check file
(`--allowedTools mcp__storytree` only). That is the harness's restriction, not a product gap, and no contract here
depends on it.

## Left on the laptop

As found: `~\.codex` byte-identical, Claude Code's hooks and tool server and the `storytree` command still the
install's, no scheduled task, process, folder or script of the run left. The four trial projects were taken off
the laptop's list with `storytree project remove`; their records stay in the laptop's own library, as that
command keeps them.
