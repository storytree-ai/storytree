# The stable acceptance run on the old laptop (increment_82ef0ee2a9c9, ADR-1032 D6)

Before stable moves, a model-driven user on the old laptop (winlap) installs that exact build the way a first user
would and builds a project end to end; when that passes, the owner gets one yes-or-no question, and his yes pins it.
This folder holds the run (`harness/run.sh`), its judge (`harness/judge.sh`, `harness/criteria.md`) and the routine
that starts it every fortnight (`harness/fortnight.sh`, installed on the Mint box by `harness/install-timer.sh`).
Evidence stays out of the repository's history: each run writes `~/storytree-lanes/stable-acceptance/<stamp>-<version>/`
on the Mint box.

## Status, 2026-10-16

Proven on winlap with 0.3.1464 (`20261016-trial2-0.3.1464`): a fresh user made and removed, Claude Code installed
for it, the stable one-liner installing exactly that build as stable (88 s), the app opening on its first-run guide,
and screenshots of the app's own window from the run. **Not yet proven:** the user's turns, the feedback page, the
re-run of the tests and the judge. The first turn could not sign in (below); the run now takes a long-lived Claude
Code token for its user, which only the owner can make, and the question for him is on arc_312aa103bfca. The timer
is not installed: it runs main's copy of this folder, so it goes in after this lands and the token exists.

## What one run does

| Phase | As whom | What |
|---|---|---|
| before | owner's SSH login | `state.ps1` snapshot; `user.ps1 sweep` removes any user and profile an earlier run left |
| user | owner's SSH login | `user.ps1 create`: a standard local user `st-<build>-<MMDDHHMM>` with a random password nobody keeps, the right to log on as a batch job, and an on-demand task `st-acc-<user>` |
| prepare | the fresh user | Claude Code from its own installer, on the user's PATH; the run's token put in the run folder |
| install | the fresh user | the stable one-liner with `STORYTREE_ACCEPTANCE_VERSION`, answered 1 (Claude Code) and a project folder `~\tipjar` |
| app | the fresh user | the app reopened with a DevTools port on 127.0.0.1; a screenshot of first open |
| turn1 | the fresh user | the first-run guide's steps: the connection check, then a small tip calculator with tests (`prompts/turn-1.txt`) |
| shots1 | the fresh user | the forest and stories after the build |
| turn2 | the fresh user | the same session: feedback for storytree's makers and the test command (`prompts/turn-2.txt`) |
| feedback | the fresh user | that feedback typed into Help → Send feedback, then Open GitHub draft (a browser draft; nothing is submitted) |
| verify | the fresh user | the tests run again by the named command; the project's library read |
| after | owner's SSH login | the user, its task, profile, run folder and logon right removed; `state.ps1` again and diffed |
| judge | Mint box | `judge.sh`: a separate `claude -p` (Sonnet, read-only tools) against `criteria.md`; exit 0 only on PASS |

`run.sh <0.3.N> [folder] [phase…]` runs them all, or only the named ones to repair a run.

## What the laptop taught the harness (also in process_81a7122f6849)

- **Everything as the fresh user runs from its scheduled task, never over SSH as it.** SSH as a user, or
  `Start-Process -Credential` from SSH, leaves its profile loaded; programs started over SSH end with the session
  (the one-liner's app did); and `Start-Process -Credential` from SSH's session 0 fails with 0xC0000142.
- **A standard user may not log on as a batch job on this laptop**, so its task silently never started (last result
  267011). `user.ps1` grants SeBatchLogonRight to that one user and revokes it before removing the user.
- **Windows keeps a removed user's profile loaded until a restart**, with no process or handle of the user's left.
  Its files go at once; the folder (about 5 MB of hive) goes at the first sweep after a restart. A new user with the
  name of an unremoved profile gets `<name>.<COMPUTER>` and cannot write the old folder, hence one name per run.
- **An app a step starts keeps that step's output file open** (process_81a7122f6849 step 11), so each step writes
  its own output.
- **`storytree app quit` cannot reach an app in a task's session**: the app step stops the processes under the
  install folder instead, the installer's own rule.
- **Never copy a Claude Code sign-in between users.** On 2026-10-16 a trial user given a copy of the laptop's
  sign-in refreshed it; the refresh rotated the token, and the laptop's own Claude Code was signed out until the
  owner signs in again. The run uses a token made for it (`claude setup-token`), kept on the Mint box at
  `~/storytree-lanes/secrets/stable-acceptance.claude-token` (or `STABLE_ACCEPTANCE_TOKEN_FILE`).

## The routine

`fortnight.sh`, from a weekly timer: every 14 days (`STABLE_ACCEPTANCE_INTERVAL_DAYS`; 7 for weekly) and only while
no pin question waits on the owner, it takes `storytree release candidate` and runs the acceptance run on it. A pass
raises "Pin 0.3.N as stable?" on arc_312aa103bfca with the evidence folder, the verdict, the cost and the release
notes since the last pin; a yes is settled with the owner's words and that session runs `storytree release pin`.
A failure raises nothing to the owner: it files a friction naming a regression in that build, which `release
candidate` then passes over (with every later build, until the friction is closed), and tries the next candidate,
up to three. `cost.mjs` gives the minutes, tokens and list-price dollars of the user's turns and the judge.

Not here: the Mac acceptance run (`mac-acceptance.yml`, after every release) and Linux's, which its arc owns.
