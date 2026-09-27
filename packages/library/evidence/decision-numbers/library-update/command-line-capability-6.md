# 6 · Decisions

Record: `capability_562b2527ebca` (description).

List decisions (current, by status, load-bearing) and record a new one with an explicit `--number <n>` or, in projects that allow it, the next number, its status, who decided it in their own words, and what it supersedes. The storytree project requires an explicit number from 0.2's `adr new` until cutover. `storytree adr number <decision> <n>` calls the library's one-time Full record repair; `storytree adr number --dry-run` lists every proposed old → new number and any refusal, changes nothing, and exits nonzero when any proposal is refused. Decisions without a Full record line are untouched. Pull a decision out as a markdown file, edit it, push it back, and write its composed statement (the owner's C2).

6.1 · In projects with automatic numbering, two `adr new` run at once get different, increasing numbers.

6.2 · Pull then push with no edit changes nothing.

6.3 · A superseded decision drops out of `--current`.

6.4 · A composed statement reads stale after its decision's text changes.

6.5 · `adr pull` names a decision by id, number, or ADR number.

6.6 · `adr new --number <n>` preserves an explicit unused number and refuses a reused or invalid number. In storytree, omitting the number is refused with the instruction to obtain it from 0.2's adr new until cutover.

6.7 · `adr number <decision> <n>` delegates the one-time Full record repair to the library. `adr number --dry-run` reports old → new proposals and clear refusals, writes nothing, and exits nonzero if any proposal is refused. Both forms refuse projects other than storytree.
