# App setup's first run with Codex: model user acceptance (increment_d1c604205018, ADR-0825 D5)

The first-run journey of ../acceptance-run, driven by Codex instead of Claude Code. A model drives the product as
a first user would, and the harness, never the model, mints each contract's verdict from what it observed;
`pnpm record:acceptance <observations.json>` writes them to the verified column as "acceptance run".

## The journey (harness/)

- `prep.ps1`, over SSH: a fresh `CODEX_HOME` for the trial (process_81a7122f6849 step 10), holding copies of
  the sign-in and the one-time sandbox setup, both trial folders trusted, and no hook trusted, as for a first
  user. Then `storytree setup connect --codex` into it, as the installer's connect step runs it, from the SSH
  login, which is elevated. The owner's `~\.codex` is only read.
- `journey.ps1`, in the owner's desktop session (Codex cannot run commands from an elevated login, step 9),
  started by `../acceptance-run/harness/run-task.ps1 <stamp> 25 journey.ps1`. For each of two fresh folders:
  the installed `storytree doctor` from a fresh PowerShell; one new Codex session (`codex exec`) asked "I'd
  like to build a small to-do list web page in this folder, and I want storytree to keep its plan. Please set
  storytree up for this folder, as the project <name> …"; `storytree doctor` again, its exit code, and where a
  fresh PowerShell finds the command. At the end: where the trial's Codex home starts storytree's tool server,
  how many hooks it trusts, and the app's version.
- `observe.mjs` turns those raw outputs into checks. It reads only what storytree's installed command, the
  trial's Codex home and the machine said; the model's replies (`codex-*.txt`) are kept as evidence and never
  read. It voids the run if the app updated during it.

## Run of 2026-10-01 (2026-10-01/, stamp cx02)

Laptop `micksoldlaptop`, Windows 11 x64, no Git and no Node on the path; storytree 0.3.414 (built from
e221468e8451) before and after the run; Codex 0.158.0 signed in.

| Contract | Verdict | What the harness saw |
|---|---|---|
| 2.2 a new session in the folder, and later in another, reaches that folder's setup check | **passing, 4/4** | In each folder: not a project before; after one Codex session, `storytree doctor` names the project the session was asked for. |
| 2.6 Codex's hooks wait on the user's trust, and storytree says so | **passing, 5/5** | The installation result says Codex's tools are connected and its hooks wait for the user's trust, naming `/hooks`, and that Codex cannot run commands from the administrator terminal it ran in. With no hook trusted in Codex's home, `storytree doctor` in each folder says the same. |
| 1.5 after an update the next session starts compatible tools from a durable place | not checked (nothing written) | With no Node and no Git on the path both sessions set their folder up, and Codex starts the tool server from the installed app's own `resources\agent-tools`; but the app took no update before this run. |
| 1.6 the command runs from a fresh terminal; an existing one is preserved | not checked here | A fresh PowerShell finds `~\.storytree\0.3\bin\storytree.cmd` and doctor exits 0 in both folders; the existing-command clause is ../acceptance-run-conflict's journey. |

An earlier run that day (stamp cx01) is not kept: it ran before `prep.ps1` saved the installation result and the
hook-trust count, so 2.6 could not be observed. The lane driving these runs was cut off by a machine restart at
about 11:50 AEST; cx02 had finished at 11:52 and its outputs were copied off the laptop afterwards.

Both Codex sessions answered, unprompted, that recording needs the user to type `/hooks` and trust storytree's
hooks: the setup check's own words reached the model. Nothing here reads that.

## Left on the laptop

Checked with `../acceptance-run/harness/state.ps1`: the owner's `~\.codex` was last written at 00:27 that day,
before both trials; Claude Code's and Codex's hooks and tool servers and the `storytree` command still the
install's; no scheduled task or process of the run left. The four trial projects were taken off the laptop's
list with `storytree project remove`, and their folders, the trial Codex homes and the run's scripts deleted.
