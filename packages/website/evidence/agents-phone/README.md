# The agents chapter on a phone (increment_4274bd965ee7, contract 2.18)

**Before** (`before/`) and **after** (`after/`) at 1440×900, 390×844 and 320×700, each step of the agents chapter on the
shop's recorded moments. They are made from the locally built site by
`node packages/website/evidence/arrival/capture.mjs --only agents --to agents-phone/after`.

| | Before | After |
|---|---|---|
| Parallel step, 390 | Part 3's tag ran off the right edge and over Browsing's ring; Part 4's sat on the globe's top edge | All three tags read whole, inside the screen. Part 4's sits above Checkout, Part 3's between the islands, and Part 2's to the left of Browsing (`after/390-agents-parallel.png`) |
| Parallel step, 320 | Part 3's tag was clipped to "Par… cart page a"; Part 4's was hidden under the sessions list | Each tag finds room beside, above or below its ring, clear of the list and the card (`after/320-agents-parallel.png`) |
| Arcs and claim steps, 390 and 320 | The arcs drawer's briefing ran under the card and covered the whole globe | While the tour plays, the drawer shows its list of arcs only (the shop's first arc: 2 landed, 3 open) and ends above the globe. The claimed cart and its tag are in view (`after/390-agents-claim.png`, `after/320-agents-claim.png`) |
| Every step, 1440 | — | Unchanged. The arcs, fix and sessions steps match pixel for pixel; the others differ only by the globe's drift between captures |

**See:** on a phone, the three claimed islands are named in their sessions' words, and nothing is cut off or stacked.
**Feel:** the chapter reads as composed for the phone, not squeezed onto it.
**Think:** "each island says whose it is", which is the step's point.

How:
- `placeTags` (`src/tour.ts`) puts each name on the first side of its ring (right, left, below, above) that stays inside the
  screen and clear of the other names, the other rings, the card, the sessions list and the arcs drawer. Its previous side
  is tried first, so a name doesn't flit as the globe turns. Island names are kept clear too, but they count less when no
  side is clear. A laptop keeps its old rule: right, or left where the right has no room.
- `src/freeplay.css`, at 600px and under, while the tour plays: the sessions list scrolls past 140px; the arcs drawer
  sizes to its list of arcs, with the briefing hidden; and the globe moves 32px down, at the same size, so the step's
  islands sit between the panel and the card.

Checks:
- `tour.test.ts` 2.18 was red (no `placeTags`), then green.
- The browser journey `--verify-immersive` now checks the arcs, claim and parallel steps at 390 and 320: every tag is
  inside the screen and clear of the other tags, the card and the panels, and the arcs drawer ends above the card.
  Its pictures and measurements are in `journey/`.

Laptop residue, parked as increment_d9d744221102: at 1440 the parallel step's Part 2 and Part 3 tags overlap
(`before/1440-agents-parallel.png`). It is left as it was, on the instruction that the desktop stay unchanged.
