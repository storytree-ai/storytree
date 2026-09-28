# App setup: Windows first-user retest (increment_94525b4e9028)

Run 2026-09-29 overnight (AEST) on the owner's old laptop, from the Linux box over SSH, after the fixes for the
first run's five gaps (#207, #208, #209, #211, #212) had merged. The brief: retest the first-user journey, fix
what fails, and loop until it is smooth, for at most three rounds. Nobody was at the keyboard.

**Verdict: PASSED in round 3 (v0.3.250).** Round 1 found that the very first Claude Code session after install
still did not ask the setup question; round 2 found that, once asked to, the agent did the task first and asked
after. Both were fixed (#213, #215), with one wording fix in the setup check (#214). Round 3 passed every step.

## Machine and method

- Same laptop as the first run (`../acceptance/README.md`): Windows 11 Home x64, local user, Windows PowerShell
  5.1. Claude Code 2.1.283, signed in throughout. Codex CLI 0.158.0 installed only for step 5 of each round and
  removed at its end.
- **Round 0** returned the laptop to a first-user state (`round-0/`): storytree uninstalled with its home, updater
  cache and PATH entry; storytree taken out of Claude Code (its tool server and every hook and status line
  entry, leaving `theme` and `autoUpdatesChannel`); `~\.codex` deleted; **Git, Node and GitHub CLI uninstalled**
  (Codex had installed them in the first run), so Claude Code has no Bash tool and runs commands with its
  PowerShell tool; the first run's test folders deleted and its evidence folder renamed `st-evidence-run1`.
  Before rounds 2 and 3 the same reset ran again (`round-<n>/reset.txt`, `state-before.txt`).
- Each round waited for a GitHub release built from a main that contained every merged fix
  (`round-<n>/release.json` names the SHA): round 1 v0.3.247 (d89735b), round 2 v0.3.249 (43a6804),
  round 3 v0.3.250 (af52f8c).
- Everything that needs the desktop ran in the owner's session through a one-shot interactive scheduled task,
  deleted as soon as it finished (`harness/run-interactive.ps1`, driven by `harness/lap.sh`). Claude Code ran as
  `claude -p … --allowedTools mcp__storytree Edit Write Bash PowerShell` with stdin closed, in the desktop session
  (`harness/lap-claude.sh`). The transcripts here are rendered from its stream-json (`harness/render.py`); the
  raw files stay off the repo because they carry account-specific plugin paths.
- App screens were driven over DevTools with real mouse and keyboard input (`harness/cdp.mjs`, `harness/gui.sh`),
  using storytree's own bundled Node since the laptop has none; the app was restarted with a debugging port for
  this and normally afterwards. Screenshots are the app's own page, or the storytree window alone
  (`harness/screen-app.ps1` uses PrintWindow), so nothing else on the desktop appears.

## Results by step and contract

| Step | Contract | Round 1 (v0.3.247) | Round 2 (v0.3.249) | Round 3 (v0.3.250) |
|---|---|---|---|---|
| 1. One-liner from a folder with spaces, choose 1 | 1.1, 1.2, 2.1 | PASS: 470 s, "tools connected; hooks not verified", folder left empty (`round-1/install-1.txt`) | PASS: 432 s (`round-2/install-1.txt`) | PASS: 481 s (`round-3/install-1.txt`) |
| 1. App window stays up 5 minutes after "ready" | 1.2 | PASS: same window and processes at +0, +2, +5 (`round-1/watch-plus*.txt`, `app-plus*.png`) | PASS (+0, +1, +2, +5) | PASS (+0, +2, +5) |
| 2. Repeat from a second spaced folder | 1.3, 2.3 | PASS: 3 s, no download, exe untouched, "tools already connected", both folders empty, PATH not duplicated (`round-1/install-2.txt`) | PASS: 3 s | PASS: 3 s |
| 3. First session, no mention of storytree, asks before creating anything | 2.2; agent link 8.12 | **FAIL**: created `hello.txt` without asking; no start hook ran (`round-1/claude-1.txt`). A second session in a new folder did ask (`claude-2.txt`). Fixed by **#213** | **FAIL**: the start hook ran, but the agent created the file first and asked after (`round-2/claude-1.txt`). A/B: `round-2/ab/`. Fixed by **#215** | **PASS**: asked, created nothing (`round-3/claude-1.txt`) |
| 3. Yes, then a fresh session verifies all four hooks on Git-less Windows, command by the PowerShell tool | 2.6 | PASS: "The connection is verified: … start, a storytree tool call, a file edit and a command"; command via `PowerShell` (`round-1/claude-3.txt`, `claude-4.txt`) | PASS (`round-2/claude-2.txt`, `claude-3.txt`) | PASS (`round-3/claude-2.txt`, `claude-3.txt`) |
| 4. Second empty folder, second project only after a second yes; both selectable | 3.3 | PASS: asked, then set up only on yes (`round-1/claude-5.txt`, `claude-6.txt`); picker lists both and switches (`round-1/shots/app-2…4`) | PASS (`round-2/claude-4.txt`, `claude-5.txt`, `shots/app-3…4`) | PASS (`round-3/claude-4.txt`, `claude-5.txt`, `shots/app-2…4`) |
| 5. Codex: `setup connect --codex`, repeat | 2.1, 2.3, 2.6 | PASS: "tools connected; hooks not verified", then "already connected", one entry (`round-1/codex-connect.txt`) | PASS; with #213 Codex's hooks are in place at connect (7 entries, one set after the repeat) | PASS (`round-3/codex-connect.txt`) |
| 5. `setup disconnect codex`; a Claude Code check does not bring Codex's hooks back; Claude still verifies | 2.5 | PASS: `hooks.json` absent after the check; Claude verified; doctor says Codex disconnected (`round-1/codex-disconnect.txt`, `claude-8.txt`) | PASS (`round-2/claude-6.txt`) | PASS (`round-3/claude-6.txt`, `codex-hooks-after-claude.txt`) |
| 5. A live Codex session | 2.2 for Codex | WAITING: needs the owner's browser sign-in | WAITING | WAITING |
| 6. First-run guide | 3.1, 3.2 | PASS (`round-1/shots/app-5-help-guide.png`) | PASS | PASS |
| 6. License offline (firewall block on the app) | 4.1 | PASS: PolyForm Shield 1.0.0 shown, "available offline" (`round-1/shots/app-6-license-offline.png`) | PASS | PASS |
| 6. Feedback draft opened, not submitted | 5.1, 5.2, 5.4 | PASS: "Opened a draft in your browser. Review it on GitHub and submit it yourself." (`round-1/shots/app-7…8`) | PASS | PASS |
| 6. Updates panel on an up-to-date install | app 4.7 | PASS: "Up to date · Running 0.3.247" (`round-1/shots/app-9-updates.png`) | PASS (0.3.249) | PASS (0.3.250) |
| 6. `storytree own --all` shows nothing left running | processes | PASS: "No recorded runs in this scope" (`round-1/own-all.txt`) | PASS | PASS |
| 7. The repository front page shows the install command | F2 (#209) | PASS (`round-1/front-page.txt`) | (not repeated) | PASS; release notes open with "## Install" (`round-3/front-page.txt`) |

## Fixes made during the retest

- **#213** (88f0cd5): `storytree setup connect` registers the chosen agent's hooks (and Claude Code's status line)
  with its tool server. Before, the hooks arrived when the first session's tool server started, after Claude Code
  had read its hooks for that session, so the first session never had #211's start hook. Red then green:
  `packages/app-setup/src/connect/connect.test.ts` "2.2: connecting registers the chosen harness's hooks …".
- **#214** (43a6804): the setup check names only the agents whose hooks are in place (it said "Claude Code and
  Codex" on a Claude-only laptop), and gives the true reason a session's start is not yet received (the session
  began before its folder was a project), instead of always blaming mid-session hook registration.
- **#215** (af52f8c): the start hook tells the agent to ask first and end its turn to wait for the answer. An A/B
  on the laptop (`round-2/ab/summary.txt`): the old wording, 3 of 3 sessions did the task first; the new, 3 of 3
  asked first and created nothing.

## Still rough (not failures of a step)

- The setup check (and `storytree doctor`) tells a first Windows user that git and Node 24 are missing and to
  install them, although the app carries its own Node for everything the agent link runs. This is what ADR-0716
  decided a first run needs, so changing it is the owner's call. With an auto-approving agent told to follow
  check_setup, it is how Git, Node and GitHub CLI got installed in the first run.
- `storytree own --all` always adds "Reading incomplete: some work could not be observed." even on a machine
  with nothing running.
- Each round's feedback step left a GitHub draft page open in the owner's browser (not submitted).

## What was left on the laptop

storytree 0.3.250 installed and running (`%LOCALAPPDATA%\Programs\storytree-0.3`, home `~\.storytree\0.3` with
the two round-3 projects `retest-three-a` and `retest-three-b`), connected to Claude Code (tool server, hooks and
status line in `~\.claude\settings.json`); Claude Code installed and signed in. No Git, Node, GitHub CLI or
Codex, and no `~\.codex`. The round-3 test folders `C:\Users\mickh\Retest 3 …` (four), the harness and outputs
in `C:\Users\mickh\st-retest`, and the first run's `st-evidence-run1`. No scheduled tasks, firewall rules or
debugging ports left (`round-3/state-after.txt`). Reolink untouched.
