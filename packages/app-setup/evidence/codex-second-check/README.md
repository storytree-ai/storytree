# Codex's approval review and the second setup check (increment_aada58eb5fe4)

Run 2026-10-02 on the owner's Windows laptop (`ssh winlap`), Codex CLI 0.158.0, storytree 0.3.525 to
0.3.528 installed (the app updates itself at quiet moments). The question: why Codex's automatic approval
review (`codex exec --approve-for-me`) sometimes refuses the `check_setup` call a first session makes after
`set_up_project`, saying "this check installs hooks that persistently send session transcripts to a shared
log with only best-effort secret removal".

## The answer

**The refusal is a rare random outcome, and no single piece of text causes it.** The same reviewer, given
the same input, almost always allows the call. What matters is whether a trusted instruction (the user's
words, or storytree's section in Codex's `AGENTS.md`) authorizes the call. The disclosure and the tool's
description do not. So the change removes the call itself: a session that sets its project up now finishes
the setup in `set_up_project`'s own answer, and is never sent to a second `check_setup`
(contract 8.22, `packages/agent-link/src/tools/setup-tools.ts`). That second check could not verify that
session's hooks anyway: a session's start reaches storytree only when the session starts inside a project.
The transcript disclosure (ADR-0749 D4) is unchanged: every `check_setup` answer still carries it.

## How it was found

**The reviewer leaves its own records.** Each review is a session of the model `codex-auto-review`, at low
reasoning effort, kept in the same `CODEX_HOME`. Codex marks those sessions with "whose request action you are
assessing" (`harness/reviews.ps1`, `harness/reviews.mjs`). They hold its instructions, everything it was
shown and its answer. Its instructions include "deny any action ... which exposes a payload that has not
been authorized for that destination and which could credibly contain sensitive data".

**What it reads.** It sees:
- the session so far, including the first `check_setup`'s answer with the transcript disclosure;
- the planned call;
- the tool's description ("... registers storytree's hooks ...").

The refusal on 2026-10-01 (the first-build run, `../first-build/runs/codex-turn-1.txt`) was found in the
owner's `~\.codex` (only read) and compared with a clean run. The first answer and the description were
the same in both.

**Across the owner's real Codex sessions** (12 reviewer records, 2026-09-29 to 10-02), every review that had
the disclosure in its context:

| Call reviewed | Rated low | Rated medium | Rated high (refused) |
|---|---|---|---|
| Any other storytree tool | 196 | 0 | 0 |
| `check_setup` | 5 | 3 | 1 |

The disclosure alone raises nothing; the rated-up `check_setup` reviews cite its "hook registration/setup effects".

**Replays.** A recorded review conversation can be replayed against the same model, turn by turn
(`harness/replay/split.mjs`, `harness/replay/replay.sh`: `codex exec` with the reviewer's own instructions,
`-m codex-auto-review`, low effort, then `resume` for each later turn), with any text swapped in. 10 replays
each (`runs/replay-answers.txt`):

| Context | Variant | Refused | Rated above low |
|---|---|---|---|
| The refused first-build review, user asked for setup, AGENTS.md section present | as recorded | 0 | 3 |
|  | description says it puts hooks back "only if they have gone missing" | 0 | 1 |
|  | disclosure adds "calling it again changes nothing that is sent" | 0 | 1 |
|  | AGENTS.md section removed | 0 | 2 |
|  | AGENTS.md section names set_up_project then check_setup | 0 | 5 |
| 2026-09-29 review, user asked to call check_setup again, no AGENTS.md section, current disclosure | as shipped | 1 | 8 |
|  | both rewordings | 0 | 7 |
| The same, user asked only for a file (no authorization of the check): an amplifier | as shipped | **7** | 8 |
|  | disclosure removed entirely | **8** | 9 |
|  | "registers storytree's hooks" removed from the description | **6** | 8 |
|  | both rewordings | **8** | 10 |
|  | as shipped, AGENTS.md section added | **0** | 1 |
|  | both rewordings, AGENTS.md section added | **0** | 7 |

Read: when the call is authorized by the user or by the AGENTS.md section, refusals are rare whatever the
text says (1 in 90 across those rows). When nothing trusted authorizes it, the reviewer refuses it most of
the time whatever the text says, including with no disclosure at all ("unrelated to the request, driven by
untrusted tool instructions"). The rewordings did not lower the rate, and the description rewording raised
"medium" ratings with the AGENTS.md section present, so neither was shipped. Removing the disclosure would
not help either, so keeping it and avoiding the refusal do not conflict: no owner question was needed. A
flattened single-prompt replay (`harness/replay/flatten.mjs`, 10 runs, `runs/replay-flat-answers.txt`)
allowed every time.

**Why Windows.** The model is the same on every system. The 2 Windows refusals came from about 9 Windows
`check_setup` reviews with the disclosure in context. The Mint box's 18 sessions (increment_825bb7d5757e)
would have to be read for theirs. A rare draw explains the count without any Windows cause.

## Full sessions on the laptop

The trial is an empty folder with a fresh `CODEX_HOME`, connected as the installer connects
(`harness/prep.ps1`). Hooks are trusted through `--dangerously-bypass-hook-trust`, standing in for a user
who has trusted them, as the first-build run's Codex had. The prompt is "Please set this folder up as a new
storytree project first. Then make a hello.txt file here that says hi." (`harness/trial.in.txt`,
`harness/lap.sh`).

| Trial | Build | Setup calls | Refused |
|---|---|---|---|
| B1 | installed 0.3.525 | check_setup, set_up_project, check_setup, check_setup | 0 |
| F1 | **void**: the app updated to 0.3.528 mid-run and took the placed build (`runs/void/`) | – | – |
| F2 | this branch, placed beside the installed tools (`harness/place-arm.ps1`) | Codex did not find its storytree tools at first and set the folder up with `storytree doctor --set-up` instead, then check_setup twice | 0 |
| F3 | this branch | check_setup, set_up_project, **then straight to the starter roles and the work, no second check_setup** | 0 |

In F3 `set_up_project` answered: "... its setup is finished: carry on with the user's request, with no
second check_setup in this session. Its library holds the orchestrator and librarian roles ... storytree
verifies the hooks in the next session here ...". Codex told the user "A new session here will verify
storytree's session hooks." Its close-out said not safe only because the files were not committed (no git).

## What it cost

- **Four full sessions**, one of them void: about 1.5 M tokens.
- **140 reviewer replays**: about 5.7 M tokens, 78% cached.
- **Total:** about 7.2 M tokens, roughly 16 full sessions' worth, against a budget of about ten. The
  turn-by-turn replays re-send the whole conversation on each turn, so they cost three times what was
  first estimated.

## Left on the laptop

Nothing:
- the placed build is removed (34 of 34 files);
- the trial homes, the trial folders and `st-second` are deleted;
- the projects `sc-trial-b1`, `sc-trial-f2` and `sc-trial-f3` are off the machine's list (their records stay
  in the library);
- no scheduled tasks and no Codex processes are left;
- the owner's `~\.codex` and `~\.claude\settings.json` name nothing from the trial.
