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
