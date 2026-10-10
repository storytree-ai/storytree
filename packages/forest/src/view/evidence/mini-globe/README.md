# A mini globe with its poles marked, Home, and the tilt and zoom stops

The owner, 2026-10-10 (question_ca05d0fa7c21, ADR-0977): a mini globe in the top right with the north and south poles
marked, so a person can take bearings; clicking it or the Home key returns the opening view, with no double-click;
spin stays free; tilt stops before the view from over a pole; the wheel stops zooming out at half the opening size.

Captured on the actual desktop page on storytree's own globe (rows-on-screen's seed and survey: 21 stories, radius
250.4), 1440 × 960, headless Chromium on SwiftShader: `node --import tsx capture.mjs build`, then
`node --import tsx capture.mjs --retake`. Each view's reading is its `.json`: tilt (north's lean toward the eye),
north's bearing on screen, the zoom, how many islands face the eye at 0.5 or more, and the mini globe's mark in its
own 120-unit box.

| view | tilt | zoom | readable | mark |
|---|---|---|---|---|
| [opening](opening.png) | 0° | 1.462 | 11 of 21 | centre |
| [spun half round](spun-half-round.png) (a drag half the canvas's height) | 0° | 1.462 | 0 of 21 | centre, far side (dashed blue) |
| [tilted to the stop](tilted-to-the-stop.png) (back, then a drag 0.4 of the height down) | 50° | 1.462 | 6 of 21 | up at the north pole's side |
| [Home key](home-by-key.png) after another drag | 0° | 1.462 | 11 of 21 | centre |
| [wheel out to the floor](zoomed-out-to-the-floor.png) (30 wheel steps) | 0° | 0.731 (half) | 11 of 21 | centre |
| [click on the mini globe](home-by-click.png) after a drag | 0° | 1.462 | 11 of 21 | centre |

North's bearing is 0° in every view. The mini globe is drawn as the globe stood at its opening, so it never moves:
the land where it lies (solid dots on the near side, hollow rings behind), the poles with N and S, the equator, and a
gold ring on the point facing the viewer, which turns into a dashed blue ring when that point is on the far side.

**Why 50°.** The rows run from 42°S to 42°N; at 50° the top row has passed the middle of the view and the pole is still
40° in from the facing point, so the rows still read as arcs below it (`tilted-to-the-stop.png`), not the rings seen
from over the pole at the old 88° (`../rows-on-screen/tilted-to-the-limit.png`). **The Library keeps the same stop**: its
notes fill a see-through ball, and at 50° none of them is hidden, so it needs no fuller tilt.

**The website's small example** gets the same view: `packages/website/evidence/mini-globe` has the shop in free play
as it arrives, turned, and back after Home; on the site the mini globe sits below the page's bar (and below the
recording's progress label while the tour talks).

**A suggestion, built into nothing:** [poles marked on the main globe too](suggestion-poles-on-the-globe.png), at the
tilt stop. The capture script draws the two marks over the page; nothing in the product has them.
