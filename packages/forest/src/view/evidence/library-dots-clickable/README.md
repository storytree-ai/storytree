# Clickable library dots (ADR-0661)

Real desktop renderer, real library data, real synthetic pointer clicks. Read-only snapshot:
`~/storytree-lanes/snapshots/2026-09-27T13-04-06-091Z.json`, restored into an isolated temporary
`STORYTREE_HOME`. The owner's running library was not accessed.

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
clearance **0.0752400267R**, maximum loose radius **0.5455794261R**. `measure.mjs` asserts these
bounds, counts and exclusion through the production functions. Unit tests also exercise 2,000
loose artifacts.

Picking projects the rotated dots into screen space, giving each an **8 px** target. Closest
screen distance wins, with depth breaking ties. Forest keeps the far half behind the glass
shell and rejects dots behind solid land. The transparent near shell admits near-side dots;
using its nearest ray hit as an opaque blocker would prevent all interior clicks. Library
has no shell/land mask. Pointer travel of **5 px or more**, including an excursion that returns
to its start, is a drag and never opens a card.

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

Red commit: `91f6278`. Green implementation: `cf3177b`. The latest main was merged before
final verification. `pnpm typecheck` and affected `pnpm test` run under `/tmp/storytree-heavy.lock`.
The selected test units are desktop, arc-surface, forest, forest-world, knowledge-core and
package boundaries; this is the affected proof, not an assertion that unrelated units ran.

`pnpm test-ratio` all row: `all 39,244 30,115 1.30` (test lines, implementation lines, ratio).

No new desktop-smoke option was added: desktop smoke has no supported note-selection or
projection hook, and adding that seam solely for a screenshot would expand this increment.
The headless proof exercises actual pointer input in both modes. The laptop can open the
same card with a normal click.

## Reproduce

From the repository root (Playwright and Chromium paths can be overridden with
`PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM`):

```sh
export STORYTREE_HOME=$(mktemp -d)
node --import tsx scripts/restore-library.mjs ~/storytree-lanes/snapshots/2026-09-27T13-04-06-091Z.json
node --import tsx packages/forest/src/view/evidence/library-dots-clickable/export.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/src/view/evidence/library-dots-clickable/measure.mjs
flock /tmp/storytree-heavy.lock node packages/forest/src/view/evidence/library-dots-clickable/build.mjs
flock /tmp/storytree-heavy.lock node packages/forest/src/view/evidence/library-dots-clickable/capture.mjs
```
