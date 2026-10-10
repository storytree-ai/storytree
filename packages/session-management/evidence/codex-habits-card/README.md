# Does handing Codex the habits card change what it does? (increment_32b5bb7f381c, item 2)

**No, measurably not, so the change was not shipped.** Codex 0.158 never shows its model the tool server's
instructions (the habits card), so the idea was to append the card to check_setup's answer when the caller
is Codex (`armB.patch`). On the owner's Windows laptop, 2026-10-01 (release 0.3.395 to 0.3.397 installed,
Codex CLI 0.158.0), a first Codex session given a real build task already followed every habit the card
teaches, with or without it. The card would add about 5 KB to every Codex check_setup for no gain.

## Method

- **Two arms from one checkout**, differing only in `armB.patch`:
  - A is origin/main at a6d3faf (release 0.3.394's commit);
  - B is A plus the card.
- **Placement.** Each arm's `storytree-mcp.mjs` and its chunks sat beside the installed tools
  (`harness/place-arms.ps1`), so the hook script and `storytree` command it registers are the installed
  ones, as for a real user. See "A trap" below.
- **Each trial** (`harness/prep.ps1`) got:
  - a fresh `CODEX_HOME` with a copy of the sign-in and sandbox setup, and no hook trust;
  - a fresh project folder, set up and connected as a first user's is (`storytree doctor --set-up`,
    `storytree setup connect --codex`: AGENTS.md section, hooks, and the tool server with its
    `CODEX_HOME`, #350);
  - its tool server then pointed at the trial's arm.
- **Prompt**, run in the owner's desktop session: "Build me a small to-do list web page I can open in my
  browser, with a test for its logic." (`harness/trial*.in.txt`, `harness/run-all.sh`, arms interleaved).
- **Scoring.** The session's own record gives its actions in order (`harness/calls.ps1`, not the
  auto-reviewer's sessions). `harness/score.sh` scores six habits:
  1. check_setup before the first change;
  2. a story planned before it;
  3. a claim before it;
  4. red, then a change, then green;
  5. landed;
  6. closed out.

  The setup check's own `.storytree-check` test edit is not counted as the first change.

## Results

**Hooks trusted** (`--dangerously-bypass-hook-trust` stands in for the user's one-time trust; this is
the session a user has after trusting), from `trusted-scores.txt`:

| Arm | Trials | Habits followed | storytree calls |
|---|---|---|---|
| A (no card) | A4, A5, A7 | 6/6, 6/6, 6/6 | 16, 16, 16 |
| B (card in check_setup) | B4, B8, B9 | 6/6, 6/6, 6/6 | 16, 16, 16 |

**Hooks not yet trusted** (the very first session), from `untrusted-scores.txt`:

- **The sessions that built:** A1 scored 5/6 (it claimed without planning a story first); B1 and B2
  scored 6/6. Three trials cannot tell the arms apart.
- **Half the trials built nothing** (A2, A3, B3, both arms). The agent stopped before any work and asked
  the user to trust storytree's hooks, citing AGENTS.md: "Storytree's setup check requires a step from
  you before I make changes… In Codex, type /hooks and trust storytree's hooks…". That is #347's
  approval-only answer meeting AGENTS.md's "before your first change … do what it says". Asking before
  work is what increment_d911830f4957 wanted, so it is recorded here, not treated as a fault.

**Void, and why** (`void.txt`, records in `void/`):
- A6, B6: the app's updater installed 0.3.396 between trials and took the placed arms, so there was
  no tool server.
- B5 and B7 (second run): each Codex session started seconds after an update began (19:55:12Z and
  20:09:07Z; sessions at 19:55:30Z and 20:09:51Z), while the app was restarting. No update cut into a
  running session.
- The first runs of B7, A7 and B8: the arms were not re-placed after the update.

## A trap for anyone testing a built tool server on a real machine

A tool server run from a folder of its own (a built `storytree-mcp.mjs` with `storytree-hook.mjs` beside
it) makes its setup check register **its own folder's** hooks and `storytree` command for the whole
machine. The first placement, outside the install, repointed the laptop's `storytree` command and the
owner's Claude Code hooks at the arm. `~\.codex` was spared, because #350 gives the tool server the trial's
`CODEX_HOME`.

The installed build's own `storytree doctor` put both back ("replacing another build's hooks"). The
harness then placed the arms beside the installed tools. After every trial it checked that nothing
outside the trial pointed at an arm (0 each time).

## Left on the laptop

As found:
- The owner's `~\.codex` `hooks.json`, `config.toml` and `AGENTS.md` have the same hashes and times as
  before the run.
- The `storytree` command and Claude Code's hooks run the installed build.
- The 16 trial projects are off the machine's list (`storytree project remove`); their records stay in
  the library.
- The trial folders, the Codex homes (which held copies of the sign-in) and every file placed beside the
  installed tools are deleted (126 manifest entries, 0 left).
- The installed tool server and hook load and run.
- No scheduled tasks, and no Codex processes.

One thing did change: the app updated itself to 0.3.397 at a quiet moment, as it does.
