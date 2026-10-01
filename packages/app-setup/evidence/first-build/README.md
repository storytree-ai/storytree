# First build on a new user's laptop: TodoMVC in Claude Code and Codex (increment_44bd7a583f32)

Run 2026-10-02 01:59–03:05 (AEST) on the owner's reset laptop (Windows 11 Home x64, Windows PowerShell 5.1,
no Git, Node or gh; Claude Code and Codex 0.158.0 installed and signed in), driven over SSH from the owner's
other laptop by the supervising session (process_81a7122f6849). The laptop's own agents did the building; the
supervisor prompted them the way a user would, graded their builds off the laptop and never edited them.
This is the warm-up of arc_424dae58bf1b (First builds on a new user's laptop).

**Verdict.** A first user can install storytree with one command, connect both agents, and get a real, working
app built by either agent, with storytree's plan, claims, landings and health filling in as it happens and the
app drawing it. Both agents used storytree unprompted. Both builds reach the official TodoMVC suite's ceiling.
Two gaps would stop a first user recommending it, and both are parked: every capability reads **UNTESTED, the
agent moves this one** although the agent tested it and cannot move it (increment_ef066f718a63), and Codex's
approval review refused the second setup check over transcript logging on Windows again (increment_aada58eb5fe4).

## The journey

| Step | What | Result | Evidence |
|---|---|---|---|
| Reset | `storytree setup uninstall --remove-library`, old trial folders to the Recycle Bin | storytree gone in 26 s; Claude Code and Codex still signed in | `runs/state-0-before.txt`, `runs/state-1-clean.txt` |
| Install | The one-liner from the home folder: 3 (both agents), project folder `todo-claude` | **128 s**: download 35 s, install 38 s; project set up; Codex's hooks wait for the user's trust | `runs/install.transcript.txt` |
| First view | The app opens on its first-run guide, which names the Codex trust step | as designed | `shots/s2-app-first-view.png`, `s2-app-empty-forest.png` |
| Codex trust | `codex` in a neutral folder: "Hooks need review" → 2 (Trust all) | trusted (8 `trusted_hash` entries); a user step in Codex's own window | — |
| Claude Code turn 1 | "a to-do list app … work exactly like TodoMVC (spec) … official template and CSS … no build step" | **337 s, $1.43**: check_setup, read the starter roles, planned 1 story / 5 capabilities / 13 contracts / 1 arc / 2 increments, claimed, wrote browser tests (headless Edge, no Node), red then green, landed, closed both increments and the arc, wrote a decision and a friction, closed out safe | `runs/claude-turn-1.txt`, `shots/c1-forest-mid-turn1.png` |
| Codex turn 1 (new folder) | "Please set this folder up as a new storytree project first. Then build …" (same ask) | **481 s**: set up `todo-codex`, planned 1 story / 1 capability / 1 contract, built and tested (26 assertions, headless Edge); its approval review **refused the second check_setup** over transcript logging; asked the user to approve; closed out not safe | `runs/codex-turn-1.txt`, `shots/c1-forest-after-turn1.png` |
| Grade 1 | Official suite (tastejs/todomvc ff43b02e, Cypress 15.14.2, framework vanillajs) | Claude **22/29** (5 fail, 2 skip); Codex **0/29**: the new-todo input carried both `id` and `class`, which the suite refuses as ambiguous | `grade/` |
| Claude Code turn 2 (same session) | the grader's failure list | **178 s, $0.83**: parked and claimed an increment, new contract, red then green: list items kept in place across renders; said 2 failures are the suite's; **24/29** | `runs/claude-turn-2.txt` |
| Codex turn 2 (same session) | "Yes, go ahead and finish the storytree setup" + the grader's result | **1062 s**: check_setup passed; removed the extra ids; fetched a portable Node and Cypress into %TEMP% (~250 MB) and ran the official suite itself: **24/29** unmodified, 29/29 with the two suite bugs patched in a copy; reported the unmodified contract red | `runs/codex-turn-2.txt`, `shots/t2-app-during-turn2.png` |
| Claude Code turn 3 (fresh session) | "is the last failure ours? … short status" | **90 s, $0.48**: found its place from the library (show_plan, search_notes found turn 2's diagnosis), confirmed from the suite's source the reload failure is the suite's, wrote it as a decision; no code change | `runs/claude-turn-3.txt` |
| Updates | Two releases arrived during the run | 0.3.473 waited 22 min while agents worked, installed in the gap between turns; 0.3.476 installed 12 s after Codex's turn ended. No session broke | `~\.storytree\0.3\releases.log` on the laptop |
| Switch projects | App menu → Projects → todo-claude | forest, sessions and files switch | `shots/p1-projects.png`, `p2-forest-todo-claude.png` |
| Story panel | Click the island | five cards, all **UNTESTED**, "Why not green: no test names … The agent moves this one." | `shots/p3-island-todo-claude.png` |
| Arc surface | Open arc surface → Closed | "TodoMVC app v1, closed, 3 landed" with its briefing | `shots/p4-…`, `p6-arc-briefing-todo-claude.png` |
| Library | `storytree tree` / `arc list` in each folder | holds each agent's story, capabilities, contracts, arc, increments and reported health; nothing held after close-out | — |

**The ceiling.** At its pinned Cypress the official suite fails 3 and skips 2 of 29 for any app: it calls a spy
method (`reset`) Cypress 15's sinon no longer has, and it reuses `.as()` aliases of created items across a page
reload. Both agents reached 24/29, and both diagnosed the suite's two bugs themselves.

## Gaps, each an object

- **Health wording in a user's project** → increment_ef066f718a63 (arc_5180ec6f2563). Nothing writes the verified
  column for a user's project (ADR-0630), yet the reason says the agent should move it.
- **Codex's approval review refuses check_setup on Windows** (2 of 2 Windows runs now, 0 of 18 on Linux) →
  increment_aada58eb5fe4 (arc_cfc7db517fae).
- **The story panel's capability cards are too small to read** → friction_0069afc5f6e3.
- **The close-out reminder fired for this branch before it had a commit** → friction_ec191ac911de.
- Watch items carried into Conduit 1 (increment_582e3e3643df): Codex plans coarsely (1 capability where Claude
  Code planned 5); neither agent installed Git. A headless Edge from an earlier session (2026-10-01, user data in `%TEMP%\todo-browser-check`) was still running; this round's agents left none.

## How it was driven

`harness/`: `turn.ps1 <claude|codex> <n> <folder> [-Fresh]` runs one user turn in the desktop session (Claude
Code `-p --permission-mode bypassPermissions`, `--continue` for later turns unless `-Fresh`; Codex `exec
--approve-for-me --json`, `resume --last` for later turns), started by `start-task.ps1` (a one-shot interactive
scheduled task, deleted after). `appshot.ps1` captures the app's own window with PrintWindow, covered or not, so
no restart with a debug port is needed while agents work (a restart stops the database they use). `sum.mjs` and
`csum.mjs` summarise the transcripts into `runs/`. `prompts/` holds every user turn as sent.

`grade/grade-todomvc.ps1 -AppPath <folder> [-Runs n]` places a copy of the app in a sparse clone of the suite,
serves it with the suite's own server and runs the unmodified spec; copy `grade/` outside the repository first
(it installs Cypress beside itself).

Not proven here: a session open in an interactive agent window across an update (the turns were headless, so
no agent process lived between turns); Windows arm64 (dropped from the MVP).
