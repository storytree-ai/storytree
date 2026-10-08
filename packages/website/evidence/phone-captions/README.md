# Phone island captions inside the view — 9 October 2026

Increment `increment_105e46adad04`, residue of the 8 October review (`../review-2026-10-08`).

## Red

The 2.18 journey (`tour.mjs`, `verifyAgentTags`) now also requires each tagged island's name wholly inside the screen, and a new
check (`verifyNamesClearHeader`) plays the map chapter through and requires every shown island name clear of the heading and the
dated note. Before the fix, against the built website:

- `Cart 0 / 2 landed` left the screen on the agents-claim step: x = -11.5 at 320×844, -1.8 at 320×700; with the claim step
  fixed alone, -3.7 (320×844) and -4.2 (320×700) on agents-parallel.
- On map-first, Cart's faint name sat under the dated note at 390×844, 320×844, 320×700 and 320×568.
- Laptops (1280, 1440, 1920) already passed both.

## Fix

- A phone step's view may name a `narrow` side for a 320px screen; the globe moves between `side` (390px) and it as the screen
  narrows. The claim step moves 19px right at 320, the parallel step 7px.
- On phones 360px wide or less, tag names are set at 12px with slimmer padding, so the longest (`Part 2: product page, sorting,
  cart`) still fits beside its ring once the globe moves right.
- map-first's phone camera draws back (framing 0.8 → 1.05), so Cart's name sits below the dated note.

Spoken lines, chapter order and timings are unchanged.

## Green

`node packages/website/evidence/capture.mjs phone-captions --verify-immersive` passed at 1920, 1440, 1280, 390 and 320×844 and
on the 320×700 and 320×568 phones. Only the agents-claim, agents-parallel and map-first captures are kept here.
