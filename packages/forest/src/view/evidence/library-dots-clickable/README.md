# Clickable library dots (ADR-0661)

Real desktop renderer, committed read-only library snapshot and synthetic pointer clicks.
Refreshed for `increment_bdcb6eabee69` on 2026-10-02. The capture reads `seed.json`;
reproducing it needs no library connection or restored user home.

| Measure | Forest | Library |
| --- | ---: | ---: |
| Points submitted to the renderer | 176 | 176 |
| Shelf points | 77 | 77 |
| Loose points | 99 | 99 |
| Story-text records excluded | 460 | 460 |

`isStoryText(record)` is the single exported rule: a `definition` whose term or title starts
`Story text: stories/`. Filtering changes the drawing only; library records remain intact.

Loose dots occupy a deterministic shuffled cubic lattice filling a ball within **0.55R**.
Their centers must be at least **0.035R** apart and clear of shelf points; the drawn dot diameter
is **0.012R**. On this snapshot: minimum loose separation **0.1513165074R**, minimum shelf
clearance **0.0663055450R**, maximum loose radius **0.5455794261R**. `measure.mjs` asserts these
bounds, counts and exclusion through the production functions: `forestScene` →
`storyNodes` → `planetLayout` → `globePoints`, using the drawn globe’s radius and
row positions rather than treating an encoded row/slot as an XYZ point. Unit tests also exercise 2,000
loose artifacts.

Picking projects the rotated dots into screen space, giving each an **8 px** target. Closest
screen distance wins, with depth breaking ties. Forest keeps the far half behind the glass
shell and rejects dots behind solid land. The transparent near shell admits near-side dots;
using its nearest ray hit as an opaque blocker would prevent all interior clicks. Library
has no shell/land mask. Pointer travel of **5 px or more**, including an excursion that returns
to its start, is a drag and never opens a card. A separate nonzero drag proves that
the globe rotation changes while the camera position and quaternion stay fixed.

The existing knowledge-core pin and card supply the right-hand story-panel slot. Its shared
renderer shows kind, title and summary (whole text if no summary), without a links list, reads,
depth or entrances. The two panel types replace each other. Close and Escape dismiss a card. Browser assertions
also cover far-side dot selection in Library, clearing hover on wheel zoom, and closing an
open card when ordinary live polling reports that its artifact was retired.

## Pictures and machine proof

- [Forest front](forest-front.png)
- [Library front](library-front.png)
- [Card opened by clicking a dot in Forest](forest-card.png)
- [Card opened by clicking a dot in Library](library-card.png)
- [Hover title](forest-tooltip.png)
- [Census and separation assertions](measurements.json)
- [Browser interaction assertions](interactions.json)
- [Observed red test output](red.txt)
- [Library text patch and application checklist](library-update/README.md)

The capture harness bundles the production desktop with observational scene/navigation hooks.
It never calls a selection function to open a card: it projects a dot, moves the pointer and
clicks using Chromium's mouse input. Captures use Chromium **148.0.7778.96**, with **ANGLE Vulkan / SwiftShader Device (Subzero)**.
Capture JSON records the complete renderer string. Browser page errors: zero.

The refresh first observed a failing census: `placeOnPackedGlobe` was no longer
exported. With current layout coordinates, all five browser views pass the point,
mode and submission checks. All 16 recorded interaction checks pass, including
hover/click, real drag, close/Escape, foreground land priority, far-side Library
selection, and live retirement. The retirement batch goes through the current
fake bridge's `storytreeAnswers`, so ordinary polling closes the selected card
and removes its dot. No direct selection function or library write is used.

I reviewed the Forest and Library card pictures after retaking them. Under
**Legible at the resting view**, the selected artifact's kind, title and body are
readable in the side panel; under **Meaning outranks appearance**, Library shows
only knowledge points while Forest retains its islands. This is browser proof,
with no laptop or Windows acceptance claim.

## Reproduce

From the repository root, using the committed seed. `CAPTURE_PLAYWRIGHT` and
`CAPTURE_CHROMIUM` can override the installed browser/module; legacy `PLANET_`
variables remain supported.

```sh
node --import tsx packages/forest/src/view/evidence/library-dots-clickable/measure.mjs
node packages/forest/src/view/evidence/library-dots-clickable/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/src/view/evidence/library-dots-clickable/capture.mjs
```

Default runs write to the temporary `storytree-captures/` folder. To refresh the
committed expected census and then its browser evidence, pass `--retake` to both
`measure.mjs` and `capture.mjs`. The capture always compares against the committed
`measurements.json`; a scratch census never silently replaces that baseline.
