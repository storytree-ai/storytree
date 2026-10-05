# App setup: a first build in a fresh folder, as an acceptance run (increment_8f7a6bdd3e78, ADR-0825 D5)

A multi-turn Claude Code build in an empty folder on the old Windows test laptop, judged by what the project's
library and activity log hold, read back with storytree's installed command: never the model's account. The harness
mints each contract's verdict; `pnpm record:acceptance <observations.json>` writes it to the verified column as
"acceptance run". Contract 2.7 (Connect an agent) was planned for this run (arc_e05282628cd8's end state).

## The journey (harness/)

- `held-journey.ps1` runs `journey.ps1` under the app's update hold (`packages/app/src/updates/hold-run.mjs`, copied
  beside it; process_81a7122f6849 step 19), started in the owner's desktop session by
  `../acceptance-run/harness/run-task.ps1 <stamp> <minutes> held-journey.ps1`.
- `journey.ps1`, folder a (`~\st-accept-fb-<stamp>-a`): `storytree doctor`; turn 1, a new `claude -p` session asked
  to set storytree up there as a named project (`prompts/turn-1.txt`); doctor again, its exit code, and where a fresh
  PowerShell finds the command; turn 2, a second new session asked to build a to-do page with tests and keep the
  plan in storytree (`turn-2.txt`); turn 3, that session continued (`--continue`) for a filter, with tests
  (`turn-3.txt`). During turns 2 and 3 a watcher runs `storytree tree` every few seconds (`watch.txt`), because the
  command shows a contract's reported health as it stands, not each state it had. Folder b, later: doctor, turn 4
  (set up a second project), doctor. Every session runs with storytree's tools, Edit, Write, Read, Glob, Grep, Bash
  and PowerShell allowed (step 7); the transcripts (`turn-*.jsonl`) are kept as evidence. A stamp starting `dry`
  swaps every prompt for "Reply with just the word ok.", to test the capture cheaply.
- `read.ps1`, over SSH afterwards, in folder a: `storytree doctor`, `tree`, `noticeboard`, `noticeboard log`,
  `library list` of stories, capabilities, contracts and increments, `arc list` and `arc show`, `library read` of
  each increment and `library history` of each contract's reported health.
- `observe.mjs` turns those into checks. It reads only what the installed command said; the transcripts are never
  read. It voids the run if the app's version changed.

## Run of 2026-10-05 (2026-10-05/, stamp fb01)

Laptop `micksoldlaptop`, Windows 11 x64, Node 22 and Git on the path (installed by an earlier first-build round);
storytree 0.3.691 (built from e5570c3a) before and after the run, held from updating throughout; Claude Code
2.1.283 on its default model (claude-opus-5-5), with the laptop's own sign-in. A dry run (stamp dry1) first proved
the exit-code, version and watcher capture; its folders and outputs were deleted.

| Contract | Verdict | What the harness saw |
|---|---|---|
| 2.7 a first build in a fresh folder leaves a true plan | **passing, 9/9** | Folder a was not a project, and was project `st-accept-fb-fb01-a` after the first session. The library holds 1 story, 4 capabilities, 12 contracts, and 1 arc (closed) with its 2 increments, both closed as landed. The activity log has the build sessions' start and 7 claims on 6 units (2 increments, 4 capabilities); each ended with a landed or closed line, and the board says nobody holds anything. The watcher saw all 12 contracts reported failing, then passing. |
| 2.2 a new session in the folder, and later in another, reaches that folder's setup check | **passing, 4/4** | In each folder: not a project before; after one new session, `storytree doctor` names the project the session was asked for. |
| 1.6 the command runs from a fresh terminal; an existing one is preserved | not checked (nothing written) | A fresh PowerShell finds `~\.storytree\0.3\bin\storytree.exe` and doctor exits 0 in both folders; the existing-command clause is ../acceptance-run-conflict's. |

How it went, so a later run can compare (from the transcripts, which no check reads): turn 1 called `check_setup`
then `set_up_project` and nothing else (13 s, $0.16). Turn 2 (6 min, $1.58) wrote the hook check file, called
`check_setup` again, read the plan and two starter roles, planned the story, three capabilities and nine contracts,
an arc and an increment, claimed, wrote each test before its code, reported red then green, landed each capability
and closed the increment as landed (no Git repository, so no pull request), then `close_out`. Turn 3 (3 min, $2.65)
parked and claimed a second increment, planned the Filter capability and its three contracts, and landed it the
same way; 12 tests pass in the folder (`files-a.txt` lists what it wrote). Turn 4 matched turn 1.

Seen along the way, parked rather than fixed here: `storytree tree` prints each capability's number twice
("1 · 1 · Item list", `read/tree.txt`; increment_7077a40515df). In turn 3, `land` refused two capabilities because
`app.js` was reached by their numbered tests only through a shared test helper that required it; the agent recorded
it as friction in its own project and required `app.js` in each test (increment_8a81477484c9). The set-up session's own hooks cannot reach the
project it creates mid-session, so doctor says "No hook has reached storytree in this project yet" until the next
session; that is setup check 8.22's design, and 2.2 is judged by the project it made.

The transcripts had the laptop's claude.ai connectors (the owner's account's) taken out of their tool and server
lists before they were committed; nothing else in them was changed, and no check reads them.

Windows PowerShell 5.1 decodes the command's output with the console code page on its way to a file, so "·" reads
"┬À" in `read/` and `watch.txt`; observe.mjs reads past it.

## Left on the laptop

Compared with `../acceptance-run/harness/state.ps1` before and after (`state-before.txt`, `state-after.txt`): the
owner's `~\.codex` byte-identical; Claude Code's hooks and tool server and the `storytree` command still the
install's; the app still 0.3.691; no scheduled task left (the one process listed each time is the SSH command running
the state script). The two trial folders and their projects stay, as the earlier first-build rounds kept theirs;
the run's scripts folder (`~\st-accept-run`) was deleted. Claude Code keeps the sessions' transcripts under
`~\.claude\projects`, as for every earlier round.
