# The shop rebuilt with storytree's guardrails in place (increment_fc8ae627477d, ADR-0911 D5)

The same shop as the first build (`../shop/`) and the parallel rebuild (`../shop-parallel/`), built a third time on the
old Windows laptop by its own Claude Code, two or three sessions at once, in the same five rounds, but with the
guardrails of ADR-0911 in place from the first session: `storytree check` in the shop's CI on every pull request
(wired by the agent with `wire_pipeline`), and the agent link's landing hold. The supervising session on the Mint
box drove the laptop over SSH, answered as the user, graded off the laptop and never edited the shop's code.

New names, fallbacks untouched: folder `C:\Users\mickh\shop3`, project `shop3`, private repository `HuaMick/shop3`,
harness folder `~\st-guard`. `shop`/`shop2`, their folders, repositories, projects and saved data were not touched.

**Result: zero unallocated files at every landing.** All 13 landings on `main` kept both of `storytree check`'s
rules. The shop's own CI verified every one of its 34 capabilities healthy. Swag Labs' suite passed 26/26 (its
ceiling) and our wave 2 suite 29/29, both at the first grade of the finished shop.

## What changed from the parallel rebuild

- **storytree 0.3.685 on the laptop from the start.** That release's commit (aadbc84) includes #644
  (`storytree check`), #648 (the landing hold) and #650 (`wire_pipeline`). The laptop's `storytree --version` read
  `0.3.685 (aadbc84)`, and `storytree check --help` answered.
- **The spec's CI line no longer dictates the workflow.** It now reads "automatic checks on every pull request (at
  least `npm test`)" (`harness/shop-requirements.md`), so the agent's own habits choose how to wire it.
- **Harness:** the parallel rebuild's, copied and re-pointed at `shop3` (`harness/`). Two scripts are new:
  - `check-results.sh` reads each archived CI run's `storytree check` result into `checks/landings.tsv`;
  - `costs.sh` totals agent time and cost per turn (see "Cost" below).

## R1: planning, then signing in first

One fresh session (`harness/prompts/r1-part1.txt`, 1,241 s) set up `shop3` and planned the whole of wave 1: 4 stories,
16 capabilities, 34 contracts, one arc ("Swag Labs copy"). Then, **at setup, it called `wire_pipeline`** with
`npm ci` / `npm test`. That wrote storytree's workflow: the tests on Linux, plus `storytree check` from storytree's
source at the laptop's release tag (`v0.3.685`). It built part 1 and merged shop PR #1 once both checks passed.

- **The landing hold fired once, mid-round.** Part 1's first `land` named Signing in files no numbered test
  reached. The agent placed them (numbered tests that import them) and landed again.
- **Branch protection: proposed, approved, refused by GitHub.**
  - The agent proposed protection in `wire_pipeline`'s words and asked the user. The user approved it for this
    repository only.
  - Running the proposed `gh api … /branches/main/protection` returned 403: "Upgrade to GitHub Pro or make this
    repository public". A free account cannot protect a private repository.
  - The agent changed nothing, offered three ways on (Pro, public, or merge only after both checks pass) and
    raised a question in the shop's library. The user chose the last.
  - Parked for storytree: increment on arc_4b5defdde736, "wire_pipeline knows a free private repository cannot
    have branch protection".
- **Grade:** 3/4, with the same flaky locked-user sign-in both earlier builds hit (2 of 5 runs,
  `runs/r1-login-5x.txt`). Told as a user would (`prompts/r1-fix.txt`), the same session fixed it at its cause
  (shop PR #2). After that: **4/4**, and the login spec passed 5 of 5 (`runs/r1-login-5x-fixed.txt`).

## R2: browsing, the cart and checkout, by three sessions at once

Part 2 started at 02:26:12Z, and parts 3 and 4 a minute later (same prompts as the parallel rebuild). Each
session made its own storytree workspace, claimed only its own story's parts, and changed only its own package
(`shots/r2-during.png`: three sessions, each island in its session's colour).

| Lane | Time | Landed |
|---|---|---|
| part 2, Browsing | 875 s | shop PR #3 at 02:39:46Z |
| part 3, Cart | 972 s | shop PR #4 at 02:42:08Z, after `storytree check` failed its first push (3 files reached only through the server's plugin loading); it imported them in its tests and pushed again |
| part 4, Checkout | 1,191 s | shop PR #5 at 02:46:17Z, after `storytree check` failed its first push (4 files reached only through a shared helper); fixed the same way |

**Grade of `main` after R2: 26/26**, Swag Labs' ceiling.

**The guardrail at work:** two of three sessions would have landed unallocated files, the defect this rebuild
exists to avoid. CI refused both pull requests, and each session placed its files before merging. The landing
hold did not have to fire.

## R3: wave 2 planned

Wave 2's spec was dropped into the folder, and one fresh session was asked to plan only (545 s).

**What it planned:** four new stories, each with its own package (Accounts, Orders, Admin, Reviews). Search and
stock went into Browsing. The plan grew to 8 stories, 34 capabilities and 76 contracts, under a second arc,
"A proper shop".

**Its three questions, answered as a user** (`prompts/r3-answers.txt`, 147 s):
- whether to sign the cookie: no, it's a test shop;
- whether to split part 9 into two halves, because its second half touches Finish and the header: yes;
- whether to commit the spec first, so workspaces made from `main` can see it: yes, as shop PR #6.

## R4 and R5: wave 2 in parallel, and the session that stood down

**R4: parts 5, 6 and 9 at 03:02Z.**
- Part 5 landed shop PR #7, after `storytree check` failed its first push (3 files) and it placed them.
- Parts 6 and 9 each ended their turns while their CI was still running. Told "please carry on", they did:
  - part 6 merged PR #9;
  - part 9 merged PR #8, then waited for parts 5 and 6 and built part 9's second half (taking stock at Finish, the
    Admin link) as PR #10.
- The app's globe went blank under the load (`shots/r4-after.png`), the known fault already parked as
  increment_d0c8f5088868.
- **Grade:** 26/26 official; ours 19/29. That is parts 5, 6 and 9 in full; the ten failures are parts 7 and 8, not
  yet built. This matches the parallel rebuild at the same point.

**R5: parts 7 and 8 at 03:35Z.**
- Part 7 landed search as PR #11.
- Part 8 landed reviews in a new package as PR #12, merging part 7's change to the Products page first.
- **The stand-down.** At 03:37:12Z the user sent the same part 7 prompt to a third, fresh session, as before. It
  read the plan, made nothing and claimed nothing (43 s):
  > Part 7 (Search) is already being worked on by another session, so I've stopped there. I haven't made a
  > workspace or changed any code.
- Asked to take part 8 over if it had stalled, it looked at part 8's workspace, found it written to 16 seconds
  earlier, and left it alone. Told to leave both parts, it closed out safe. The owner settled that standing down
  this way counts as the turned-away claim (question_29337cbd5041).

**Grade of the finished shop: 26/26 official, 29/29 ours**, both at the first grade (`runs/r5-grade.txt`).

**One follow-up: Reviews' untested promises.**
- The shop's tests reached every file, but two Reviews contracts had no numbered test: "1.2 · rating is the average
  to one decimal and the count" and "3.1 · each product on Products shows its rating". So two capabilities could not
  be verified.
- Told so as a user (`prompts/r5-reviews-tests.txt`), part 8's session added the tests and broke the code on
  purpose to see them fail. Its duplicate 3.2 now lands as 3.1's test (shop PR #13, 365 s).
- Its account: "The plan was too large to read directly, and my filtered summary of it left out any promise
  without 'review' in its title."
- The landing hold checks files, not planned contracts. Filed as friction_a193988ad179.

## `storytree check` at every landing

`checks/README.md` has the table, one row per shop pull request, from the shop's own CI logs.

- **13 of 13 push runs on `main` kept both rules.**
- **19 pull-request runs:** 16 kept both rules. Three failed the allocation rule before merge (parts 3, 4 and 5)
  and were fixed by their sessions before landing.
- **One run on `main` was red for another reason.** The run after #3 failed its first attempt in the check job's
  install, not on a rule: storytree's workspace reaches `onnxruntime-node`, whose postinstall download timed out.
  The re-run kept both rules. Parked as an increment on arc_4b5defdde736: the check's install should never fetch
  what it doesn't use.
- **The landing hold fired once, in R1, mid-round, and the agent placed its files.** It never had to fire at the end
  of a round.
- **On the laptop at the end** (`runs/final-check-and-health.txt`): `storytree check` passed on `main`.

## Verified health covers every capability

- **Before the fix, health ci read nothing.** Its first run in the shop's folder read 0 test results.
  `wire_pipeline`'s workflow pins Node 24, whose `node --test` prints its spec format in CI, and CI health read only
  TAP. That would hold for every project on storytree's own workflow.
- **The fix:** storytree #655 (increment_8ed65b3f98d5, CI health contract 1.3) reads the spec format. It reached the
  laptop in 0.3.689.
- **After the fix,** in the shop's folder: "Read 79 test results … 76 contracts verified passing, 0 failing".
  `storytree tree` shows **all 34 capabilities "storytree verified passing; healthy"** (`runs/verified-tree.txt`).
- **The globe agrees:** after a restart, the laptop app's globe draws all eight islands green, with no hatched
  ground (`shots/r5-after.png`).

## Time and cost

| | Parallel rebuild (shop2) | Guarded rebuild (shop3) |
|---|---|---|
| Result | 26/26 official, 29/29 ours | **26/26 official, 29/29 ours** |
| Unallocated files on `main` | 29 at the end (`storytree check` run later) | **0 at every landing** |
| Capabilities verified healthy by CI | 28 of 31 | **34 of 34** |
| Sessions, follow-up turns | 12 sessions, 2 follow-ups | 11 sessions, 8 follow-ups (protection, the flaky sign-in, the planner's questions, two "carry on", the takeover question, the stand-down, Reviews' tests) |
| Agent time, summed over turns | 10,410 s | **10,369 s** |
| Cost, as Claude Code reports it | $39.64 | $59.45 |
| Cost, each dollar counted once | $35.34 | **$37.76** |
| Wall time of the rounds | 6,145 s (R1 2,049 · R2 1,232 · R3 583 · R4 1,484 · R5 797) | **5,973 s** (R1 1,781 · R2 1,254 · R3 692 · R4 1,587 · R5 659), plus 365 s for Reviews' tests |
| Shop pull requests | 12 | 13 |

**How cost is counted** (`harness/costs.sh`, `runs/costs.txt`):
- Claude Code reports a resumed session's cost cumulatively: a resumed turn's figure includes that session's
  earlier turns. The parallel rebuild summed those figures; its r1-fix's $5.48 included r1-part1's $3.91.
- "Each dollar counted once" subtracts the session's previous turn. On that basis the two builds cost about the
  same: $37.76 against $35.34.
- The reported figure is higher here only because this build resumed sessions more often (8 resumed turns against 2).

**How wall time is counted:** sequential rounds (R1, R3) sum their turns, and parallel rounds (R2, R4, R5) run from
first start to last end. R4 includes about 40 s between the first turns ending and the "carry on" turns starting.

## The globe at each stage (the laptop's own app)

| After | Picture | What it shows |
|---|---|---|
| before | `shots/r0-before.png` | the app on `shop2` before this build began |
| R1 | `shots/r1-after.png` | four islands planned; Signing in and Browsing (its products list) built by part 1 |
| R2, during | `shots/r2-during.png` | three sessions building, each island in its session's colour |
| R2 | `shots/r2-after.png` | "landed" meters on Cart and Checkout, but no land: the main folder had not been pulled (increment_23546de8c3b6) |
| R3 | `shots/r3-after.png` | wave 2 planned: eight stories |
| R4, during | `shots/r4-during.png` | six sessions listed, three building wave 2 |
| R4, R5 | `shots/r4-after.png`, `shots/r5-during.png` | the globe blank under load (increment_d0c8f5088868) |
| end | `shots/r5-after-before-restart.png`, `shots/r5-after.png` | after `main` was pulled and the app restarted: eight green islands, roads, no hatching |

## Export for the website

`export/shop3-snapshot.json` is the same file as `packages/website/src/shop-snapshot.json`: **27 dated stages**,
01:45Z to 04:25Z on 2026-10-05, with health verified from the shop's CI at every stage. It shows **no unallocated
territory at any stage**, and all 34 capabilities are verified passing at the end.

```
node --import tsx packages/website/src/refresh-shop.ts --project shop3 \
  --repository ~/storytree-lanes/shop-guarded-grade/shop.git \
  --record ~/storytree-lanes/shop-guarded-private/library-final.json \
  --ci ~/storytree-lanes/shop-guarded-private/ci --output packages/website/src/shop-snapshot.json
```

The export first found only 5 stages. The shop's agents squash-merged (`… (#N)`), and the export knew only
GitHub's merge commits (`Merge pull request #N`). It now reads both (website contract 3.11).

## Private records (Mint box)

`~/storytree-lanes/shop-guarded-private/`:
- library records `library-r1` to `library-final.json`;
- every turn's transcript;
- the CI archive (`ci/`);
- grade logs (`grade-logs/`).

The grade folder, with its mirror clone, is `~/storytree-lanes/shop-guarded-grade/`.
