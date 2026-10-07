# The parallel step's islands on a phone (increment_cd960e2a7da9, contract 2.18)

**Before** (`before/`, main at 2207e3f4) and **after** (`after/`) at 390×844 and 320×700, the agents chapter played in
order, so the parallel step is reached from the claim step as a visitor reaches it (the claim step is kept for that
context). They are made from the locally built site by
`node packages/website/evidence/arrival/capture.mjs --only agents --to agents-parallel-phone/after`, keeping the phones'
claim and parallel pictures.

| | Before | After |
|---|---|---|
| Parallel step, 390×844 | The three islands in one column down the middle; Part 2's tag over the cart's ring, Part 3's and Part 4's tags over Cart's and Checkout's names, Browsing's name under the card | The column drawn back and moved to the left edge, each tag to the right of its ring, every tag and name whole between the sessions list and the card (`after/390-agents-parallel.png`) |
| Parallel step, 320×700 | As at 390 | Tags clear of one another, the rings, the list and the card; Browsing's name still touches the card's top edge (parked: see below) |

**See:** three islands stacked down the left, each with its name beneath and its session's tag beside it.
**Feel:** tidy: the step's three things read at a glance, nothing under anything.
**Think:** "three islands, three sessions, the same three rows as the list above", which is the step's point.

How:
- The step has a phone view of its own (`phone` in `src/tour.ts`, used at 600px wide or less by `src/forest-scene.tsx`):
  the overview the claim step left, at framing 1.4 rather than 1.05, with the globe's middle 107px left of the screen's
  (`src/tour-copy.ts`). The laptop's view is unchanged.
- A phone's tag beside its ring may also slide up or down by a quarter or half of the ring when its centred place is not
  clear (`placeTags`): at 390 Part 2's tag, centred, touched the top of Browsing's own name by half a pixel.

Checks:
- `src/tour.test.ts` (2.18): the 390×844 placement, red before the slide (Part 2's tag on Browsing's name), green after.
- The browser journey `--verify-immersive` (`evidence/tour.mjs`, 2.18) now checks the tagged islands' names on phones too
  (it did on laptops only), and on every width that each name is clear of the tags. On main it fails at 390 ("Part 2 … is
  clear of ring 1"). On this branch it passed whole in four of six runs; the other two failed earlier, at 1440 or 1920,
  on the laptop's claim step, where the arcs drawer sometimes covers Part 3's tag: main fails that the same way (two of
  three runs), and it is parked on the arc.
- A short phone (320×700) has about 121px between the sessions list and the card, and three tags and three names stacked
  need about 126px, so not every name can be clear there; that is parked on the arc as its own increment.
