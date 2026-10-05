# The tour re-pointed at the guarded rebuild (shop3, ADR-0911 D5)

The tour's chapters now replay the shop rebuilt with storytree's guardrails in place
(`packages/app-setup/evidence/shop-guarded`). The parallel rebuild (shop2, 4 October) is replaced. The new
recording has no unallocated code at any stage, so no step shows hatched ground. All 34 of its capabilities are
verified from the shop's own CI.

`before/` is main before this change and `after/` is this branch. Both hold every step the shop is taught on, at 1440
and 390, from `node evidence/arrival/capture.mjs --only chapters --to shop3-repoint/<before|after>`:
- the fixes hand-off;
- the map chapter's eight steps;
- the agents chapter's five steps;
- the parts, code and health steps with their How and Why opened (`-depth`).

The opening and knowledge steps play on storytree's own globe, so the shop does not change them.

**Not changed here:** the map chapter's camera and visibility gaps. Step 2's planned stories are too small to see,
step 7's islands sit tiny at the top edge, and step 8's Orders are out of frame. They show in both sets, for the
owner's step-by-step review; a separate lane builds his answers.

## What moved

| Step | Before (shop2, 4 October) | After (shop3, 5 October) |
|---|---|---|
| map-planned | four stories planned at 05:48 | at 01:53 |
| map-first | pr1, 05:59 | pr1, 02:06 (that landing also built Browsing's products list) |
| map-together | pr3 to pr5, 06:53 to 07:06 | pr3 to pr5, 02:39 to 02:46; the replay starts at `pr4-building`, the round's first stage the globe draws |
| map-parts, code, health | the shop at 07:25 (stage pr5) | at 03:00 (stage pr4), before wave 2 began |
| map-grow | Orders arrives at `pr6-building` | at `pr7-building` |
| agents (three at once) | 06:50 | 02:33: "Part 2: product page, sorting, cart", "Part 3: cart page and side menu", "Part 4: Checkout" |
| agents-standdown | 08:03, the session's words about c3831547 and 83723b4f | 03:40, its words: "Part 7 (Search) is already being worked on by another session, so I've stopped there. I haven't made a workspace or changed any code." |
| story titles | "The cart" | "Cart" (the new shop's own name) |

## Found on the way

The first after-pictures showed map-together as an empty globe. The replay skips a stage that changes nothing on
the globe, and in the new recording `pr3-building` is such a stage, so the step fell back to the growth's start.
A test now holds every stage a step names to one the replay draws (2.16).

## Tests

- **2.16:**
  - the map chapter's order from the new stages;
  - the walk stands on `pr4`;
  - Orders arrives at `pr7-building`;
  - every named stage is drawn;
  - no stage has unallocated code. This replaces the interim test that framed the least-hatched story "until the shop
    is rebuilt clean".
- **2.14, 2.17:** project `shop3`, the story `Cart`, and the live session names at the two recorded moments.
- **Saved snapshot 3.11:** the export names stages by pull request whether it was merged or squashed.
