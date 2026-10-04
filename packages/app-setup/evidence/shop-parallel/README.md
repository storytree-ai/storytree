# The shop rebuilt with agents working side by side (arc_13b5a610cc80)

The same shop as the first build (`../shop/`, arc_04c1b9977f4f), built again on the old Windows laptop by its
own Claude Code, but with two or three sessions at once, each in its own storytree workspace, so Act 2's agents
chapter can show real sessions side by side and a real turned-away claim. The supervising session on the Mint
box drives the laptop over SSH, answers as the user, grades each round off the laptop, and never edits the
shop's code. The first build's repository (`HuaMick/shop`), project (`shop`), folders (`~\shop`, `~\st-shop`)
and saved data (`~/storytree-lanes/shop-private`, `shop-grade`) are left untouched as the fallback.

## Rebuild 0: the decisions (increment_e7bcbb08f93e)

**1. Same specs, suites, grader and recording.** Swag Labs' own suite for wave 1 (ceiling 26/26), our frozen
wave 2 suite (`../shop/grade/wave2/`, 29 tests) for wave 2, graded by the first build's `grade-shop.sh`
unchanged (`grade/grade.sh` only points it at this build's repository and grade folder). The library record
(`harness/record-library.sh`, the first build's `record-library.ts` for project `shop2`), a mirror clone of the
repository after each round, every CI run archived, and the laptop app's window after each round.

**2. A fresh project:** folder `C:\Users\mickh\shop2`, storytree project `shop2`, private repository
`HuaMick/shop2`. The user's spec (`harness/shop-requirements.md`, `-2.md`) is the first build's with two
changes: the repository's name, and **one package per story from the start** ("a story is one thing a shopper
does"), the layout the first build's user chose in its session 2, so land shows from the first landing.

**3. Rounds.** From the first build's parts and what each needs:

```
part:   1 sign in ─┬─ 2 browsing (product page, sort, cart buttons, badge)   products island
        + products ├─ 3 cart page + menu                                       cart island
                   └─ 4 checkout                                               checkout island
        wave 2 plan ─┬─ 5 accounts      6 orders      7 search
                     └─ 8 reviews (needs 6's orders)  9 stock + admin (touches checkout's Finish)
```

| Round | Sessions at once | Parts |
|---|---|---|
| R1 | 1 | set up `shop2`, plan the whole of wave 1, build part 1 (the server everything else stands on) |
| R2 | **3** | parts 2, 3 and 4: the products, cart and checkout islands built at the same time |
| R3 | 1 | wave 2's spec dropped in; plan what is new, build nothing |
| R4 | **3** | parts 5, 6 and 7 |
| R5 | **2** | parts 8 and 9 |

Each round is graded on the merged `main` once its last lane lands (the round's highest part, earlier parts
as regressions). Lanes start in the project's main folder; the user tells each that other sessions are
working at the same time and to work in a workspace of its own, as a user running parallel sessions would.

**4. The turned-away claim, honestly.** Nobody edits the library to stage it. Two lanes are given overlapping
work, as a user easily would: part 2 owns the cart badge (spec part 2), and part 3's user also asks that the
badge be right on every page, including straight after Reset App State. Part 2's lane starts first; part 3's
and part 4's a few minutes later, so whichever claims the badge's part second is refused for real. If round 2
produces no refusal, round 4 and round 5 have natural overlaps too (orders and stock both change checkout's
Finish; reviews and stock both change the product page), and the write-up says which round it happened in.
A refused lane is told by storytree to pick other work; once the holder lands, the user tells it to carry on.

**Found on the way: a refusal left no trace.** `claim` returned "held" before writing anything, so the library's
activity log could show claims and takeovers but never a claim turned away. Fixed on its own pull request
(increment_bb7e0f2e68d3): a `claim-refused` line names the session that was refused, what it reached for,
the holder, and its reason (agent link contract 5.2), written by both `claim` and `make_workspace`.

**5. Harness** (`harness/`), the first build's adapted for lanes:
- `lane-turn.ps1 -Turn <name> [-Resume <session id>]`: one user turn of one lane, prompt
  `prompts/<name>.txt`, fresh or resuming that lane's own Claude Code session (with several sessions in one
  folder, `--continue` would be ambiguous); records the app version before and after, and the session id.
- `held-lane-turn.ps1`: the same inside an update hold (the first build's `hold-run.mjs`); each lane holds its
  own lease, so the app updates only when no lane is working.
- `start-task.ps1`: the first build's, in this build's laptop folder `~\st-par`, one scheduled task per lane.
- `lanes.sh` (Mint): `push`, `start <turn> [session]`, `wait <turn>…`, `fetch <turn>…`, `shot <name>`,
  `session <turn>`.
- `record-library.sh <label>`: the library record after each round.

## R1: part 1, one session (increment_3c0c11637a86)

One fresh session (`harness/prompts/r1-part1.txt`, 1,110 s, app 0.3.636) set up `shop2`, planned the whole of
wave 1 and built part 1. **Land from the first landing** (`shots/r1-after.png`): the user's spec asked for one
package per story, and the agent made four (`signing-in`, `browsing`, `cart`, `checkout`), numbered its tests
by contract, and the globe drew all four islands with file dots and roads after PR #1.

It took "two or three sessions building the other parts at the same time" as a design brief: it made all four
story packages and the shared files in part 1, including the one piece parts 2 to 4 all use (the cart store,
which reads and writes `cart-contents`), so "each later part can work inside its own package without editing
anyone else's code", and it told the user how to start the other sessions. Its plan: 4 stories, 15
capabilities, 39 contracts, 20 decisions, one arc with an increment per part.

**Grade:** 3/4. The locked-user sign-in test failed 3 runs of 5, the same timing failure the first build hit
(the error came back on a new page after a form post). Told as a user would (`prompts/r1-fix.txt`), the same
session (resumed, 939 s) fixed it at its cause and merged PR #2, and recorded a rule in the project for the
parallel sessions to come: anything a Swag Labs test checks straight after a click must change inside the page.
After PR #2: **4/4**, and the login spec passed 5 runs of 5 (`runs/r1-grade-fixed.txt`, `runs/r1-login-5x.txt`).

The library after R1 (`library-r1b`, kept privately): 4 stories, 15 capabilities, 40 contracts, 21 decisions,
521 activity lines. Every shop CI run is archived privately (`harness/ci-archive.sh`); its logs carry TAP with
contract-numbered test titles, which verified health from CI (ADR-0901) reads.

## R2: parts 2, 3 and 4, three sessions at once (increment_74ff85c17194)

Three fresh sessions on the laptop at the same time (app 0.3.640, which records refused claims): part 2 started
at 06:47Z, parts 3 and 4 a minute later, when part 2 already held its three parts, the cart badge among them.
Each made its own storytree workspace (`.claude\worktrees\increment-…` in the shop's folder), claimed only its
own story's parts, ran its own copy of the shop on its own port (3102, 3104) so as not to collide with the
others, and changed only its own package. Claims and landings as the library recorded them: `runs/r2-claims.txt`.

| Lane | Time, cost | Landed |
|---|---|---|
| part 2, Browsing (72cbaf46) | 886 s, $2.38 | shop PR #4 at 07:00:58Z: product page, sorting, Add to cart / Remove, the badge |
| part 3, The cart (182c4d96) | 1,167 s, $3.21 | shop PR #5 at 07:06:32Z: Cart page, menu; merged parts 2 and 4 into its branch and ran Swag Labs' suite on the three together (29/29 in Edge) before merging |
| part 4, Checkout (de0fbc58) | 788 s, $2.67 | shop PR #3 at 06:59:48Z, first of the three: the three checkout pages, tax in whole cents |

**Grade of `main` after the round: 26/26**, Swag Labs' ceiling, at the first grade (`runs/r2-grade.txt`). Wave 1
took two rounds of agent time (R1 and its follow-up, then R2 at once) where the first build took four sessions in a row.

**No claim was turned away in R2, and why.** The overlap was real: part 3's user asked for the badge to be right
after Reset App State, and the badge is part 2's ("Cart buttons and badge", Browsing). But the agents shared work
through the project instead of colliding: R1 had already built the cart store all three parts use; part 2 recorded
a decision ("The cart badge is browsing's header piece, on every signed-in page") and told the others in its
answer that changing the cart through the store is enough for the badge to follow; part 3 left the badge to part 2
("Part 2's session built the badge itself, so I didn't touch it"), proved Reset empties it on every page with a
test of its own, and broke Reset on purpose to see that test fail. A refusal still has to happen for real
(the arc's end state), so R4 and R5 are cut where wave 2's spec itself makes two parts change the same thing
(below).

**What else the round showed.** Three sessions on one Windows machine each hit the same PowerShell 5.1 quoting
trap with `gh pr create --body` and `git commit -m`, and each recorded it in the shop's library (a friction, a
reinforcement of it, a principle: "Hand gh and git any text with quotes in a file"), so the project learned it
three times in one round. Part 4 noted that the project's process for running Swag Labs' suite assumes port
3000, which parallel sessions avoid.

Pictures: `shots/r1-after.png` (the globe as R2 began) and `shots/r2-after.png`: the same four islands, each now
fuller of file dots, roads unchanged (no new dependencies between stories).

## R3: wave 2 planned, nothing built (increment_4e4f66a1ee1c)

Wave 2's spec (`harness/shop-requirements-2.md`) dropped into the folder, and one fresh session asked to plan only,
told that three sessions would next build parts 5, 6 and 9 at once, then two build 7 and 8 (`prompts/r3-plan.txt`,
583 s, $2.55). It planned four new stories, each with its own package (Accounts, Orders, Stock and admin,
Reviews), and put search inside Browsing as a seventh capability, so the globe grew from 4 islands to 8
(the library after R3: 8 stories, 31 capabilities, 84 contracts, 46 decisions).

It planned for the parallel sessions on purpose: a brief per part naming what it builds, where, and which Swag
Labs tests it must re-run; one data file per story; **"each shared file has exactly one part allowed to change
it"**, with the few expected merge overlaps named; slots on the product pages so reviews and stock do not edit the
same lines. And it **split part 9**: 9a (stock, prices, the admin page) runs beside 5 and 6, while 9b (`admin_user`,
the Admin link, taking stock off at Finish) waits for 5 and 6, because taking stock off at Finish lives inside
part 6's order saving. It asked the user two questions in the library: whether to add `npm run reset`, since Swag
Labs' checkout tests sell the shop out after about ten runs; and whether a hand-edited `session-username` cookie
may stand for a test shop. The user answered both in R4's part 9 prompt (yes, and yes).
