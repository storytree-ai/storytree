# The agents steps' tags on short phones (increment_754b07451f94, contract 2.18)

**Before** (`before/`, main at 2e8a1b3f) and **after** (`after/`) at 320×700 and 320×568, made from the locally built
site by `node packages/website/evidence/capture.mjs <dir> --verify-immersive`, which now plays the agents chapter at those
two sizes as well (`verifyShortPhoneTags` in `evidence/tour.mjs`). The 390×844 failure the increment was parked for was
already gone on main (#801); main passes the whole journey at 390 and 320×844.

| | Before | After |
|---|---|---|
| Claim step, 320×700 | The cart sits on the card's top edge, its name under the words | The cart and its tag between the arcs drawer and the card (`after/320x700-agents-claim.png`) |
| Claim step, 320×568 | The cart's ring and tag over the words | The cart at the left, its tag beside it, both above the words (`after/320x568-agents-claim.png`) |
| Parallel step, 320×700 and 320×568 | (not reached: the claim step failed first) | Three islands stacked at the left under the sessions list, each tag beside its ring |

**See:** on the shortest phones, the islands the step talks about and their tags in the band above the words.
**Feel:** nothing lies on the words, however short the phone.
**Think:** "that island, that session", as on a tall phone.

How:
- On a phone panel step the globe's bottom follows the card when a long step's words push the card up, rather than staying
  at 48% (`src/freeplay.css`).
- On a short phone (760px tall or less) the sessions list rises over the page's heading (hidden while the list shows) and
  the globe rises with it; under the arcs drawer the globe moves up 40px keeping its size.
- The claim step has a phone view: aimed at Checkout as before, with the globe's middle 107px left, as the parallel step
  has, so the cart's tag fits beside its ring (`src/tour-copy.ts`).
- On a phone, the names of the islands a step's tags point at count as hard to cover as a panel when the tags are placed
  (`src/forest-scene.tsx`); untagged islands' names stay soft. At 320×568 Part 3's tag otherwise took Checkout's name over
  Admin's.

Checks: `--verify-immersive` passed whole three runs running on this branch (390, 320×844, 320×700, 320×568 and the laptops),
`--verify-recording` passed. At 320×568 the claim step's Checkout name is half under the arcs drawer and Part 3's tag lies
on Admin's name; neither island is tagged on that step.
