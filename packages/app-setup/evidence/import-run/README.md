# A real open-source app imported and built on, as a user, on the old Windows machine

Increment `increment_170f452bae21` (arc `arc_c24ca73b8312`, ADR-0993). Run on 2026-10-12, 08:14 to 08:57 AEDT,
from the Mint box over `ssh winlap`, by process_81a7122f6849.

**In one paragraph.** Setup and import took 29 seconds and drew the app as one brown island, whole, with its
panel saying "Mapped: here before storytree, and assumed to be working. 279 files, 25,056 lines." Asked for a
report on the old app's data, the agent built a new package beside it (tested, reviewed, runnable) that uses the
old code without changing it. The globe was slow to show the report standing on the old app: the island sat beside
it with no road for about 20 minutes, including after an app restart, and only then rose a row with its road.
Asked for a page inside the old app, the agent wrote it into the old app's own folders, after naming that change in
its increment. That is not what ADR-0993 D10 says, and it is now a question for the owner. Old code never imported
new: the agent copied logic instead. Importing again changed nothing on the globe. What fought was mostly
storytree's: the project in an empty folder had no git repository, so review, landing and verified health all
stumbled, and work left uncommitted in the old folder was invisible to the map.

## The set-up

| | |
|---|---|
| Machine | the old Windows laptop (`winlap`), Windows 11 with Smart App Control on, Node 22.16, npm 10.9, git 2.56, no pnpm |
| storytree | 0.3.1259 before, between and after every turn (it contains every PR this arc merged, #1155 to #1218); automatic installs held for each turn by `hold-run.mjs` (150 minutes) |
| Agent | Claude Code 2.1.283, `claude -p --permission-mode bypassPermissions`, run in the desktop session by a one-shot scheduled task; turns 3 to 5 were started with `--continue` in the same folder |
| Old app | github.com/gregrickaby/viewer-for-reddit at 7352a167 (Next.js 16, 279 files, one package), the probe's choice; cloned and `npm ci`'d by the user before turn 1 (22 s and 51 s) |
| Folders | `C:\Users\mickh\st-import\reddit-plus` (empty, the storytree project) beside `C:\Users\mickh\st-import\viewer-for-reddit` |
| No Reddit app | signed out, as the probe advised: the user's prompts said there were no Reddit credentials, and asked for whatever data the viewer has without signing in |

The prompts are in `harness/prompts` and were not coached: none names storytree's tools, mapped code or ADR-0993.

## What happened, step by step

| Step | Turn | Time | Cost | What happened |
|---|---|---|---|---|
| 1. Set up and import | 1 | 29 s | $0.27 | `check_setup`, `set_up_project reddit-plus`, `import_project ..\viewer-for-reddit`: "1 mapped stories added: @gregrickaby/viewer-for-reddit". Wrote only `.storytree.json`; the viewer's `git status` stayed clean. |
| 2. The globe | — | — | — | One brown island, whole, labelled `@gregrickaby/viewer-for-reddit` (`shots/02-globe.png`); its panel says mapped, assumed working, 279 files, 25,056 lines, no health (`shots/02-panel.png`). |
| 3. Something new on the old app | 3 | 11 min 32 s | $3.83 | Story "Reddit report", one capability, six contracts, an arc and an increment; `packages/reddit-report` written test-first (six contracts reported red, then green, 7 tests); reviewed twice (3 hits, 2 fixed, 1 rejection accepted); landed, marked built, increment closed with no pull request. `npm run report` prints the summary of the viewer's 127 captured records (`runs/turn-3-report-output.txt`). The globe: see "The road" below. |
| 4. A new page inside the old app | 4 | 17 min 59 s | $5.52 | A capability "Stats page" planned on the mapped story itself, an increment whose body says "Changes the mapped viewer", and the page written at source in the viewer: 6 new files, 3 one-line edits. Viewer's `npm run check` and 51 of 51 browser tests passed; reviewed twice (2 hits, 1 fixed, 1 rejection accepted). Left uncommitted, with a question to the user asking leave to commit (the viewer's AGENTS.md says ask first). The agent's own picture of the page: `shots/04-stats-page-agent.png` (the viewer's mock Reddit, signed in as its fixture user). |
| 5. Import again | 5 | 38 s | $0.37 | "0 mapped stories added; 0 retired; 1 kept". The globe before and after is the same, pixel for pixel, over the whole globe area (`shots/04-globe.png`, `shots/05-globe.png`). |

The meta files in `runs/` hold each turn's start, end, exit code and the app version at both ends.

### The road (step 3)

After turn 3 the report's island sat beside the brown one at the same height, with no road (`shots/03-globe.png`),
and the same after quitting and restarting the app (`shots/03-globe-restarted.png`, about 35 s after relaunch).
At the same moment everything the globe is drawn from was right: the page's `codeSurvey("reddit-plus")` gave the
report `dependsOn: [the viewer]`, the page's tree marked the viewer mapped, and `storytree map` listed the
depends-on edge. By the end of turn 4 the report stood a row above the brown island with a road down to its coast
(`shots/04-globe.png`, `shots/04-mapped-panel.png`). What finally drew it is not pinned; it is parked as
increment_0da3ca81ed0a.

The report island was grey after turn 3 ("storytree does not check this project's tests yet", `shots/03-report-panel.png`)
and yellow after turn 4.

## What the agents did against ADR-0993's guidance

| Clause | What the agents did |
|---|---|
| D1 import into an empty folder | Done as written: the user's ask "bring it into the project" was enough; the import is by reference, nothing copied. |
| D2 best-efforts map, true to shape | One package, so one giant island, drawn as it is. |
| D3 brown, assumed working, no health | Globe and panel: yes. `show_plan` gave it a health reading ("reported not checked"), and the setup agent told the user "Health: not checked" (friction_b3db8ab04168). |
| D4 change only when the increment names it | Turn 3 changed nothing in the viewer. Turn 4 changed it after parking an increment whose body named the change: D4 as worded let it through. |
| D5 explore as work needs, draw what you find | Both agents read the viewer freely (39 of its files in turn 4). Turn 4 drew a capability on the mapped story through `plan_capability`, with no folders declared; the globe drew no territory for it. |
| D8 build on top as a separate service | Turn 3, as written: a new package declaring `"@gregrickaby/viewer-for-reddit": "link:../../../viewer-for-reddit"`, as the habits card says. npm has no `link:`, so it was never installed: the package runs the viewer's own tsx and vitest by relative path and imports the viewer's files through a tsconfig alias `@/*`. |
| D9 old code never imports new | Kept, in both turns. In turn 4 the agent copied the report's logic into the viewer rather than import it ("If you change one, the other won't follow"). |
| D10 a feature inside the old app brings in what serves the UI | Not followed: "a page and a nav link can only live in the viewer's own folders". Raised as question_3080de376cfb, holding increment_483faf878c6d. |
| D11 test the interface with the old code | Turn 3's tests run the report against the viewer's real schemas and fixtures. Turn 4 used the viewer's own unit and browser suites. |

## What fought

Storytree defects, each with its evidence:

- **No repository in an empty-folder project.** `quality_brief` failed on `git diff origin/main...HEAD`; `land` said no
  numbered test proves six contracts whose numbered tests passed; health never verified; closed with no pull request.
  friction_92fdf78db64a, increment_c270de438175.
- **The road came late** (above). increment_0da3ca81ed0a.
- **Work in the old folder is invisible until committed.** The mapped survey reads the import at its commit, so the
  Stats page's files never reached the map, and `quality_brief` refused the viewer folder ("The diff touches no
  file"). increment_f24b74206f4f.
- **`show_plan` gives mapped stories health.** friction_b3db8ab04168.
- **The `storytree` command is blocked by Smart App Control** on this machine (CodeIntegrity 3033/3077 on the
  unsigned 4.8 KB `bin\storytree.exe`), while the app and the agents' tool server, both run by the app's own
  node, work. friction_dc2ff8cdd0ac. The harness drove the app with `resources\agent-tools\node.exe storytree.mjs`.

The run's own agents filed two frictions in their project's library (reddit-plus, not storytree's): no git
repository (friction_692c84d9feb4) and the review brief refusing the viewer folder (friction_de9d49840378).

Not storytree's: the viewer's `format:check` fails on 340 files because git's `core.autocrlf` gave the clone
Windows line endings (turn 4 noticed; nothing to do with the import). In the harness, island clicks must be sent in
CSS pixels: this screen runs at 125%, so a point read off a capture misses the island (`window.storytreeGlobe.islands()` gives them).

## Times

| | |
|---|---|
| Clone, install | 22 s, 51 s (the user's, before turn 1) |
| Setup and import, as the user's agent | 29 s |
| Report on the old app | 11 min 32 s |
| Page inside the old app | 17 min 59 s |
| Import again | 38 s |
| Model spend | $9.99 in total (turn 1 $0.27, turn 3 $3.83, turn 4 $5.52, turn 5 $0.37) |

## How it was run

`harness/` holds what ran on the machine: `task.ps1` starts a one-shot interactive scheduled task, `poll.ps1`
deletes it when it ends, `held-turn.ps1` wraps each turn in `hold-run.mjs`, `turn.ps1` is one Claude Code turn,
`app-debug.ps1` and `app-normal.ps1` restart the app with and without its DevTools port, `stamp.ps1` reads the
version and leftovers. The captures used first-build's `cdp.mjs` (the app's own page, so no desktop or browser
detail is in them). Before and after: app 0.3.1259, no `st-*` task, no update hold, DevTools port closed.

Left on the machine on purpose, for the second slice's runs: the project `reddit-plus` (its library holds the two
built stories, the agent's question and its held Stats increment), the viewer clone with the Stats page
uncommitted, and `~\st-import` with the harness. The full transcripts (UTF-16 JSON lines, 2 to 4 MB each) are kept
off the repository, in `~/storytree-lanes/import-run-170f452bae21/` on the Mint box.
