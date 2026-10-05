# The tour stops pointing at hatched code until the shop is rebuilt clean (increment_403d1de903d3)

ADR-0911 D5, the owner's choice A on 2026-10-05: until the shop is rebuilt with the guardrails in place
(increment_fc8ae627477d), the tour names no hatched or unallocated code and frames its steps away from it.

**Before** (`before/`, main after #645) and **after** (`after/`): the fixes slide, every map and agents step at 1920, 1440, 1280,
390 and 320, and the map-parts, map-code and map-health steps with How and why open. They are made by
`node packages/website/evidence/arrival/capture.mjs --only chapters --to hatching/<before|after> [--dist <main's dist>]`.

| Step | Before | After |
|---|---|---|
| Your code is the dots (map-code) | Framed on Checkout, whose lines are 55% unallocated. How: "Code no part's tests reach is drawn hatched: nobody is watching it yet." Why: "... what has slipped through." | Framed on Signing in. How names how files are placed, and Why says each file is there to keep a promise; neither mentions hatching (`after/1440-map-code-depth.png`) |
| Parts have colours (map-health) | Framed on Browsing, with a tag "hatched: code no test reaches yet". How: "On Browsing, the dark, hatched ground is code no part's tests reach yet." | Framed on Signing in, with no tag. How ends at "matched each result to the promise it checks." (`after/1440-map-health.png`, `after/390-map-health.png`) |

At the moment those steps show (07:25, after the first round), every one of the four stories has some unallocated ground:
Signing in 22% of its lines, Browsing 33%, the cart 53% and checkout 55%. Signing in has the least, so it is the one framed.
The hatching itself stays on the globe until the rebuild removes it; nothing in the words points at it.

**See:** the code and colour steps close on an island that is mostly green and allocated, and no label calls out a gap.
**Feel:** the visitor is taught what dots and colours mean, without being steered to a flaw the next recording will not have.
**Think:** "green means its tests passed", with no detour into "and here is some code nobody checks".

Check: `tour.test.ts` "2.16 · until the shop is rebuilt clean ..." reads the shop's saved territories at each step's moment.
It asserts that map-code and map-health frame the story with the least unallocated code, and that neither carries a tag.
It was red, then green.
