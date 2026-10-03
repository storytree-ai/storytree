# The shop: Act 2's example, built with storytree on the old laptop (arc_04c1b9977f4f)

The website's Act 2 teaches on this project and replays its growth as a time-lapse (ADR-0889, ADR-0890,
ADR-0891). It is the shopping website Act 1's swarm failed to build, built properly: by the old Windows test
laptop's own Claude Code, one part per fresh session, prompted as a user would prompt it, with the whole
history recorded from day one. The supervising session on the Mint box drives the laptop over SSH, answers
as the user, grades each session off the laptop, and never edits the build (process_81a7122f6849, as for
Conduit: `../first-build/conduit.md`).

## Shop 0: the decisions (increment_a09aac7b3583)

**1. Spec and suite.** Wave 1 is a copy of **Swag Labs** (saucedemo.com), graded by Sauce Labs' own MIT
end-to-end suite, unmodified, whose ceiling is 26/26 against the live reference. Wave 2 grows the shop past
Swag Labs (accounts, orders, search, reviews, stock), graded by an acceptance suite we write and freeze before
wave 2 starts, and reported as ours. Why, and what else was weighed (Toolshop's licence forbids publishing a
derivative; nothing else has a usable suite): `research.md`.

**2. Layout for the map.** Storytree draws a story's code only from `packages/<story title, slugged>/src`,
and places a file inside a capability only through tests titled with a contract number. Conduit drew no land
because nothing told its agents this (friction_4aff028cf7f5). The user's spec asks only for what a developer
would: npm workspaces, one package per feature, each package's `package.json` naming the features it uses.
The rest is storytree's to say, so the habits card now tells a user's agent the layout storytree draws
(PR #573, ADR-0900, arc_c4bc33d72bdb). Whether a fresh agent then lays out drawable code unprompted is the
first build session's test.

**3. Recording for the time-lapse.** What an honest replay needs (real, dated, never invented: ADR-0798 D3,
ADR-0879 D7), and where each comes from:

| Needed | Source | Captured |
|---|---|---|
| The plan as it grew: stories, parts, contracts, links, reported health, by time | the shop's library: every change keeps its time (`changesSince`) | read at export; after every session `harness/record-library.sh` also saves the raw record to the lane's private folder, so a reinstall or reset cannot lose it |
| Sessions, claims, landings, by time | the library's activity log | the same |
| The code at each landing: land, parts' territories, file dots, roads from package dependencies | git: every part lands through a pull request merged into `main` of the private GitHub repository `shop` | a mirror clone on Mint after each session; at export each landing's merge commit is checked out and surveyed |
| Health | a user project's land stays neutral: nothing verifies its tests (ADR-0630) | each pull request's CI log is archived (`gh run view --log`) so verified health could be replayed later; see the question on the arc |
| Pictures | the laptop app's window (`harness/appshot.ps1`, PrintWindow) after each session; the globe at each stage rendered from the saved data at export | `shots/` |
| What each session did | Claude Code's stream-json transcript, start/end and app version per turn | `runs/` (summaries by `harness/sum.mjs`) |

The per-landing ledger is `runs/landings.md`. The original study questions, answered for this project: the
source is a new project recorded from day one (option c); the engine work is arc_839d185b251e's (another
lane), fed by the export's stages; if the shop is both the time-lapse and the chapters' example, the tour
needs no separate cut to Conduit; cost is measured at export (Conduit's 21 stages were 96 KB).

**4. Harness.** Conduit's, for Claude Code only (Codex is not used: its usage is low).
- `harness/shop-requirements.md`: the user's spec, dropped into the project folder as a user would.
  `harness/prompts/shop-<n>.txt`: every user turn as sent.
- `harness/held-shop-turn.ps1 -N <n> [-Fresh]` runs `harness/shop-turn.ps1` (Claude Code
  `-p --permission-mode bypassPermissions`, stream-json; `-Fresh` for each new part, `--continue` for a
  follow-up turn) inside an update hold (`hold-run.mjs`), started in the desktop session by `start-task.ps1`
  (a one-shot interactive scheduled task, deleted after). Each turn records the app's version before and after.
- `grade/grade-shop.sh <ref> <part> <out>` clones the shop repository at a commit on Mint, installs and starts
  it as a user would, runs the official suite against it, and `grade/summarize.mjs` reports every test with its
  part (`grade/areas.json`), the earlier parts being the regression set. `grade/setup-sauce.sh` installs the
  pinned suite once.
- `harness/state.ps1` and `projects.txt`: what storytree has added to the laptop, before and after.

## Found on the way

- **0.3.606's installed app died at startup** (PR #572's journey runtime called `sourceVersion`, which threw in
  the CommonJS desktop bundle): no window, no database, no further updates. Fixed on PR #576
  (increment_07c48d77ff4e); the missing CI launch check is parked as increment_118f74f678ef.
  Evidence: `runs/app-hang-after-update.txt`. The laptop's dead app could not update itself, so the supervisor
  reinstalled 0.3.611 (the first release with the fix) by hand, silently, on 2026-10-04 01:43 AEST: the app
  opened its window ("conduit-codex · storytree 0.3 · version 0.3.611") and its database within 45 seconds
  (`runs/state-0-before.txt`).

## The build judged (increment_70f941a84f6e)

**Result.** The old laptop's Claude Code built the shop from a user's two spec files and one-line prompts, in nine
fresh sessions plus six follow-up turns (2026-10-03 15:45Z to 20:22Z). Both waves pass in full: Sauce Labs' own
Swag Labs suite **26/26** (the ceiling the live saucedemo.com reaches), and our frozen wave 2 suite **29/29**.
After part 2, no grade found an earlier part broken. Session by session: `sessions.md`; landings: `runs/landings.md`.

| | |
|---|---|
| Agent time, cost | 9 sessions and 6 follow-up turns, 7,492 s (2 h 5 min) of agent time, $27.76 (Claude Max, as the CLI reports it) |
| Shop pull requests | 12, each merged by the agent after its own CI check |
| Plan in its library | 9 stories, 16 capabilities, 63 contracts, 35 decisions (34 on a story's or capability's shelf), 2 arcs, 1 process, 4 frictions; 2,238 activity lines from 13 recorded sessions |
| Failures at first grade | 1, the agent's own: a sign-in flaky against the official suite (part 1, caught at part 2) |
| Follow-ups from the user | the layout choice (session 2), the flaky test (2), resuming after a network outage and "push as usual" (7) |

**The globe at each stage**, as the laptop's own app drew it after each session (the land stays neutral grey:
nothing verifies a user's tests yet, question_da91783103b9). The saved growth on the website
(`packages/website/src/shop-snapshot.json`, PR #589) replays the same history in 27 dated stages.

| After | Picture | What the globe shows |
|---|---|---|
| Session 1 | `shots/s1-after.png` | 4 stories planned with roads; no land (code not yet one package per story) |
| Session 2 | `shots/s2-after.png` | land and file dots on the first two stories, after the user chose one package per story |
| Session 3 | `shots/s3-after.png` | the cart story fills in |
| Session 4 | `shots/s4-after.png` | wave 1 complete: 4 stories, all with land, 18 files |
| Session 5 | `shots/s5-after.png` | wave 2 planned: **9 stories**, new roads; sign up fills in |
| Sessions 6–8 | `shots/s6-after.png`, `s7-after.png`, `s8-after.png` | orders, search, reviews fill in one at a time |
| Session 9 | `shots/s9-after.png` | complete: 9 stories, all with land, 33 files, roads between them |

**What the tour needs, and whether the shop has it** (the arc's end state 2):
- stories as islands: 9, in two waves (4, then 5 more); several parts each: 1 to 4 capabilities per story;
- code as file dots inside the parts: yes, from the layout fix on (33 files at the end);
- health colours: **no**. A user project's land stays neutral (ADR-0630). That is the owner's question on this arc;
  every shop pull request's CI log is archived, so a later verifier could still colour the history;
- roads from real dependencies: yes, from each story package's `package.json`;
- growth over time: yes, two waves of new stories, with land filling in landing by landing (27 recorded stages);
- several recorded sessions claiming and landing parts: 13 sessions, 48 claims;
- knowledge anchored to the stories it shaped: 34 decisions on story and capability shelves, and one reused
  unprompted (session 8 applied the rule session 2 recorded).

**What it says about storytree.**
- **The guidance gap was the biggest finding.** Claude Code shows only the first 2,048 characters of a tool server's
  instructions, so until PR #579 every Claude Code agent on a user's project had seen only a third of the habits card.
  Once it arrived whole, the agent numbered its tests, asked before moving code, and drew land.
- **Continuity without chat history works.** Every fresh session found its place from the library within its first
  calls, including the session cut off by the network outage, which rebuilt part 7 from its saved plan.
- **The project's memory pays.** Session 8 found a rule the project had recorded six sessions earlier and applied it
  before any grade.
- **Gaps, each an object:** the installed app dying at startup (PR #576), the CI launch check (increment_118f74f678ef),
  the habits card's delivery (PR #579), verified health for a user's project (question_da91783103b9), and the crowded
  nameplates (friction_92d59bf69b1e). The project's daily friction cap (3) refused the agent's later reports; it
  carried the same content in questions and answers instead.
