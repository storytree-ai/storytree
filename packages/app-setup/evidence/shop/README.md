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
  Evidence: `runs/app-hang-after-update.txt`.
