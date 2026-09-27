# Globe look 2 — measurements and limits

This is a throwaway look on `spike/globe-look-2`, based on `origin/main` at
`c2ba18f`. No product source is changed, no pull request is opened, and no owner
question, increment or arc is edited. The laptop session records the look on the arc.

## What was drawn

Six untouched full-page screenshots at 1440 × 960, dark theme, using the actual
desktop renderer, HTML, styles, forest engine, story labels and controls. The
canvas itself is 1440 × 910.4375 below the app bar. Capture follows
`apps/desktop/src/forest/evidence/README.md`; the scratch launch/capture pattern
was borrowed from `spike/planet-look:apps/desktop/planet-look/`, not merged.
Chromium 148.0.7778.96 uses ANGLE / Vulkan SwiftShader Device (Subzero). These are
headless Chromium captures of the desktop page, not an Electron smoke run.

`flock /tmp/storytree-heavy.lock env STORYTREE_HOME=/tmp/globe-look-2-home pnpm seed:library`
created the isolated library. Its seven stories and 53 capability trees were read
through `pageReads`, the same API Electron answers. The seed's empty activity log
is preserved: all 53 trees are planned yellow. All five real-project pictures use
the identical input, geometry and tree forms. Every seed, render and Playwright
run held the shared heavy lock. The seed completed: 304 tests passed, one skipped,
none failed, across its seven package runs.

The sixth picture is explicitly synthetic: 36 named stories repeating the real
capability counts, with 273 trees (205 landed/passing green, 68 planned yellow).
It uses the first 36 permanent W2 places and a fixed radius of 390. Synthetic
records and diagnostic failing reports exist only in browser input copies.

Reproduction commands and scratch source are in
[`apps/desktop/globe-look-2`](../../../apps/desktop/globe-look-2/README.md).
Per-picture JSON records the actual camera, geometry, labels, smoke readout and
browser warnings; [comparison.json](comparison.json) condenses the measurements.

## The experiments and their size

The independent [patches](changes/) show the exact source substitutions used in
the browser bundle. Added/deleted lines include comments and blank lines, and
exclude capture instrumentation. Nothing from these patches was applied to the
tracked product source.

| Change | Added | Deleted | What it does |
| --- | ---: | ---: | --- |
| 1 · Middle | 12 | 3 | First failure still wins; otherwise sum the islands' unit directions and face that direction. A vanishing sum falls back to the first story. |
| 2 · Fit | 38 | 0 | Through 12 stories, fit every projected land/tree vertex about the globe centre with 64px margin per side; larger projects keep today's whole-globe framing. |
| 3 · Sea | 20 | 2 | Use slate `#29343c` instead of `#101418`, with a soft inner rim, retaining the existing L1 light and opaque sea. |
| 4 · Combined | 70 | 5 | All three independent substitutions together. |

The twelve-story cutover and 64px margin are settings for this look, not an owner
decision. Framing changes only the opening/resize zoom; it does not keep refitting
on every user turn or wheel gesture. It includes the projected geometry of the
far-side islands as well as the visible ones. It measures land and trees, with
margin for names, rather than measuring text width.

## What the pictures showed

| Picture | Zoom, CSS px/world unit | Scale over today | Island centres on front hemisphere |
| --- | ---: | ---: | ---: |
| 0 · Today | 0.9892 | — | 3/7, two almost edge-on |
| 1 · Middle | 0.9892 | 0% | 4/7 |
| 2 · Fit | 1.0012 | +1.22% | 3/7 |
| 3 · Sea | 0.9892 | 0% | 3/7 |
| 4 · Combined | 1.1746 | +18.75% | 4/7 |
| 4 · Synthetic 36 | 0.9892 | 0% | 19/36 |

The middle-facing view presents three island centres within 60° of face-on,
versus one today. It turns the first story behind the globe. It cannot bring all
seven islands face-on: W2 deliberately spreads them over the whole sphere,
including a nearly antipodal first pair. Some rim trees and labels remain; that
is a placement/occlusion limit, not something a new zoom resolves.

The mean is weak when islands surround the globe. Its length before normalization
is only 0.1174 at seven stories, and 0.0490 at 36. Going from the first six stories
to seven changes the mean bearing by 78.50°, although none of their places move.
The tiny-sum fallback avoids undefined directions, but does not remove these
large changes in opening bearing as a project grows.

Zoom alone buys just 1.22% because the seven W2 islands already span almost the
whole ball. The combined turn and fit buy 18.75%, but crop 2.88px from the sphere
at both the top and bottom of the canvas. Fitting the islands gives up the clean
margin around the ball. Turning later can also change the islands' projected
spread, so a user may need to zoom out. At 36, the fit is disabled by the stated
cutover and the whole sphere remains in view; the horizon still has thin plates.

The slate sea is much easier to distinguish from the page and reveals the
outline. It also makes the large stretches of empty water more conspicuous and
uses more of the picture's brightness. The warm island palette, ground, kit,
radius and permanent placements are unchanged.

## Checks and failure markers

All six pictures drew every expected plate with both ground and pine geometry.
The smoke readout retained seven/53 and 36/273 stories/trees respectively. The
baseline/sea/fit-only turns match, and the middle/combined turns match. PNG sizes,
unchanged seeded geometry and forms were checked directly.

[diagnostic-failures.json](diagnostic-failures.json) records a separate copy with
two opposite islands failing. With the combined look, the first failure still
opens face-on. The hidden failure's 32px marker is entirely inside the viewport
(its bottom is 927.56px in a 960px page). Clicking it brings its island face-on;
the old front failure gains the corresponding marker, also inside the viewport.
The turn and zoom tested here therefore do **not** clip a failure marker. The
existing page clamps markers to the viewport edge. This is evidence for this
desktop case, not a claim about every viewport or island count.

Clicking the newly front-facing island opened the right story panel; pointer
drag changed the camera, wheel zoom increased it, and Forest remained available.
No page exceptions, shader errors or missing kit geometry were reported. Existing
React/drei nested-root cleanup and Three.Clock deprecation warnings occurred,
plus SwiftShader readback performance warnings. No product tests or new testing
framework were added for this look.

## FOR THE OWNER

The pictures are options for your eye; no look has been adopted. The middle turn
and lighter sea make visible differences. The extra zoom is small by itself and
trades away the ball's margin when combined. If the desired result is all seven
islands face-on together, none of these three changes can deliver it while
retaining W2's spread around an opaque globe. The owner decides any next step;
this spike does not change the approved placement or question.
