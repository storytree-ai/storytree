# Islands grow with their code from anchored places (ADR-0804 D3, D7)

Increment `increment_016179957fec`, arc "Code islands". An island's land follows its story's lines of code
(0.75 ground units² a line, at least 318); each island keeps its permanent place as an anchor and is nudged
only when a neighbour's coast needs the room; when nudging cannot make room the globe's radius grows, and the
knowledge core with it. These are pictures for the owner to judge; nothing here is recorded as accepted (ADR-0794).

| Scenario | What it is | Picture |
| --- | --- | --- |
| before | no survey: every island sized by its capabilities, as on `main` before this increment | [before.png](before.png) |
| after | the real code survey (same as [../file-circles](../file-circles/README.md)) | [after.png](after.png) |
| nudged | The agent link's code doubled: its island outgrows its neighbours' room | [nudged.png](nudged.png) |
| grown | every story's code x5: nudging cannot make room, so the globe grows | [grown.png](grown.png) |

Renderer: headless Chromium 148, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Seed: the
eight-story, 58-capability snapshot of [../knowledge-under-islands](../knowledge-under-islands/), places 1 to 8.
`build.mjs` then `capture.mjs` (run as `node --import tsx` from `packages/forest`, under
`flock /tmp/storytree-heavy.lock`). Every number below is read from the drawn meshes and written by the capture
to [measurements.json](measurements.json).

## Measured before looking

**The per-line constant.** Today's land is capabilities x 318 ground units²: 58 x 318 = 18,444 in all, over
25,122 non-test lines in the survey, is 0.734 a line (the median of the eight stories' own ratios is 0.86,
the range 0.29 to 2.6). 0.75 was chosen: it keeps the seed's total land within 2% (drawn, coasts included:
22,794 before, 22,965 after) while the land now says how much code each story has.

| Island | Capabilities | Lines | Drawn land before | Drawn land after | After per line | Before per line | Nudged from anchor (ground units) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The agent link | 8 | 8,724 | 3,110 | 7,428 | 0.85 | 0.36 | 8.5 |
| The app | 4 | 1,624 | 1,693 | 1,630 | 1.00 | 1.04 | 8.5 |
| The arc surface | 5 | 895 | 2,076 | 994 | 1.11 | 2.32 | 0.0 |
| The command line | 11 | 2,299 | 4,212 | 2,236 | 0.97 | 1.83 | 0.0 |
| The forest | 7 | 2,366 | 2,731 | 2,228 | 0.94 | 1.15 | 0.0 |
| The knowledge core | 4 | 2,090 | 1,721 | 2,063 | 0.99 | 0.82 | 0.0 |
| The librarian | 6 | 729 | 2,411 | 831 | 1.14 | 3.31 | 0.0 |
| The library | 13 | 6,395 | 4,840 | 5,554 | 0.87 | 0.76 | 0.0 |

"Drawn land" is the area of each island's ground meshes, coast outset included, so about a seventh above the
nominal `lines x 0.75` (7,428 against 6,543 for The agent link). The lines-per-area spread narrows from
0.36 to 3.31 (nine-fold) to 0.85 to 1.14 (a third); the floor (318) applies to no island here.

| Scenario | Globe radius | Core reach | Total drawn land | Most any island moved | Sea between the nearest two reaches |
| --- | --- | --- | --- | --- | --- |
| before | 218.0 | 183.1 | 22,794 | 0 | 18.3 |
| after | 218.0 | 183.1 | 22,965 | 8.5 units (0.039 rad) | 12.0 |
| nudged | 218.0 | 183.1 | 29,855 | 28.8 units (0.132 rad) | 12.0 |
| grown | 287.6 | 241.6 | 103,072 | 85.3 units (0.296 rad) | 12.0 |

- Before: nothing moves, as before (nearest pair 18.3 units clear).
- After: only two islands move, the pair the agent link's growth crowds (The agent link and The app, 8.5 units
  each); the other six are exactly at their places. The sea between reaches is the 12 the layout keeps.
- Nudged: seven of the eight islands give way, none more than 0.132 rad; the radius stays 218.
- Grown: the radius rises 218.0 to 287.6 (x1.32), the core with it (183.1 to 241.6, x1.32); the largest nudge is
  0.296 rad, at the 0.3 bound; all 78 knowledge points are still drawn; no page errors in any scenario.

## What the pictures show, and what to judge

- **Meaning outranks appearance.** In [after.png](after.png) island size now tracks code: The agent link and
  The library are the two big islands, The librarian a small one, where before The command line was the second
  largest with about a third of The library's code. Judged as met: drawn land per line sits within 0.85 to 1.14 on
  all eight, and the sizes read in the order of the lines.
- **Legible at the resting view.** The eight islands, their labels and the pathways stay legible in all four;
  no label is covered by another island. In [grown.png](grown.png) The knowledge core's label sits across the
  globe's rim and The library's island reaches the bottom rim, the price of pushing every neighbour to the
  0.3 rad bound at x5 code. Concern, not fixed here: the globe is re-framed to its own radius, so a grown globe
  fills the same screen, and an island held near the rim (a big one at a far-back place) can still crowd it.
- **A connector that does not connect is a defect.** The pathways are routed on the nudged spots: every trail
  in all four pictures ends on both islands' coasts (see the route between The agent link and The library in
  [nudged.png](nudged.png)); none dangles.
- **The resting view is designed, not fitted.** The 12-unit sea is a designed floor, not a fit to this seed:
  it is the most that leaves today's seed unmoved (its nearest pair had 18.3 clear), measured between
  worst-direction reaches, so the real coasts facing each other are further apart (a layout test asserts at
  least 11 units between drawn coasts). It is below the approved ribbon envelope of 19.3 (ADR-0655 D3), which
  the frozen places meet at today's capability sizes and which nudged islands are not held to: a judgement
  for the owner to raise if the trails between nudged neighbours look cramped.
