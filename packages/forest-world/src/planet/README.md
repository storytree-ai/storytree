# Map drawing · lane B

`PlanetWorldCanvas` is the browser entry at `@storytree/forest-world/planet`.
It accepts the existing `ForestScene`, a `ReadonlyMap<storyId, { x, y, z }>` of
unit directions, the big sphere's `radius` in ground units, and the glass sheet's size: the world is drawn on the
glass sheet (ADR-1043 D1), the near pole of that sphere, flat to within a degree. The globe it once drew is retired
(increment_093d5b3b28d8, as ADR-0920 retired the flat canvas): its sea shell, orthographic eye and framing are gone.

Each island is centred before `forestDescriptors` builds it; its clipped coast then becomes one
flat, pale, see-through surface with a coast band and sides (`island-surface.ts`, ADR-0804 D1, ADR-1059 D2), set on
the sheet under a rigid tangent group. There is no ground colouring, no pines or plants, and so
no kit to parse. The canvas's eye is a perspective one, lit by soft light and one lamp over the eye's shoulder
(`sheet.tsx`, ADR-1062 D1). Plates own and dispose their surface geometry. The wheel and a pinch move the eye toward
or away from the middle of the view. Rendering runs on demand, and only
while some of the canvas is on screen (4.10, `paint-while-seen.ts`): off screen the frameloop stops,
keeping the scene, camera and clock, so a host can mount the map below the fold for free.

`plateChildren(island, descriptors)` puts the page's names, selection and claim
markers in the plate's local coordinates. `parcelSpots(descriptors)` therefore
uses those local coordinates too. The optional `rotation` quaternion and `offset` turn and place the big sphere, so a
host pans, spins and tilts the sheet without rebuilding the plates. The page, its selection handling and its
failing-story markers are lane D's work.

Clearance of 1.692108 ground units keeps the plate's origin above the sphere (so the flat surface rests on it). Each
island's ground has a depth-only copy just under it (`ISLAND_DEPTH_INSET`), drawn from outside only, so an island hides
what lies behind it.

The camera's constants live in `camera.ts`: the shipped elevation (`SHIPPED_ELEVATION_DEG`), the zoom for a viewport
(`orthographicZoomFor`, CSS pixels per unit at the middle of the view), the wheel's floor and the side offset. That zoom
sets how far the perspective eye stands off (`applySheetEye`, `sheetEyeZoom`), and the wheel moves the eye, not the lens;
what hangs under the glass shows by the angle the sheet is tilted to (`hangUnderTheGlass`).

## Historical first-slice capture (the globe, retired)

The seed at green commit `0967c43` produces six stories and 43 capability trees: the
Session management, app, arc surface, forest, librarian and library. The fresh seed
has no agent work-state entries, so the planned trees wear the existing
yellow. The capture uses those story files through `parseStory` and
`forestScene`, with stable filename ids rather than a particular database's
UUIDs. No health or synthetic stories are added.

The subsequent merge of `origin/main` (`f711563`) added the CLI story. Repeating
the seed parse then fails in that story: “the build order puts 3 · Library
before 6 · Decisions, which it depends on”. These pictures retain the passing
six-story seed from before that unrelated addition; this lane changes no
story files. The supervisor can refresh the app screenshot after that seed
issue is corrected.

- [Opening view beside the flat canvas](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest-world/src/planet/evidence/seeded-globe.png)
- [After dragging, zooming and turning](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest-world/src/planet/evidence/seeded-globe-turned.png)
- [Renderer and interaction measurements](evidence/capture.json)

Renderer: headless Chromium, ANGLE / Vulkan SwiftShader Device (Subzero).
Both views fit their own contents; they are not at the same zoom. The capture
uses preview W2 spots (128 Fibonacci directions dealt farthest first) and a
radius of 390. The component itself chooses neither: lane A supplies the
production spots and radius. Names in the capture demonstrate the host slot.
The screenshot instrument was borrowed from the look spike in this
worktree's ignored `dist` directory; it is not a new product test framework.
The laptop supervisor adds the Electron `pnpm desktop:smoke` picture.

The browser check used pointer dragging and wheel input, verified that the
camera and lamp moved and zoom increased, and checked that every plate kept
its ground and kit geometry. All six groves loaded without browser or shader
errors. A separate cold mount checked that the globe loads its kit without
preloading it or mounting the flat canvas first.

The packed placement is shown in the
[ADR-0648 page capture](../../../forest/src/view/evidence/packed/README.md), and the
[glass comparison](../../../forest/src/view/evidence/glass/README.md)
shows the current glass beside #93’s shell on the same seed.
