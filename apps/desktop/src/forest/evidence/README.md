# The globe on the forest page

Lane D, `0-3-planet-on-the-page`, following the owner's A1/W2/H1/L1 approval.
The app opens the globe, with the flat Forest one button away. Both use the same
story selection, drill-down, names, claim reading and `forestDrawn` smoke readout.
Permanent place numbers come from `storyNodes(tree, history)`, including retired
places, and feed lane A's `placeOnGlobe`. Lane B supplies the plates and L1 light.
Lane C supplies opening turns and hidden-failure bearings, converted through the
actual camera quaternion so orbiting does not break a marker's turn.

The page picks the rendered plate and pine meshes. The opaque sea stops clicks
from reaching a back island. Globe labels and claims are occluded by the scene;
names have an additional screen offset so a claim cannot cover the name when
looking straight down onto a plate. The flat drawing retains its original offsets,
camera, controls, ground and lights.

## Pictures

Renderer: **headless Chromium 148.0.7778.96, ANGLE / Vulkan SwiftShader Device (Subzero)**,
1440 × 960, dark theme. Electron has no display on this box; the laptop supervisor
adds the `pnpm desktop:smoke` screenshot.

These pictures use a fresh `pnpm seed:library` after merging lane E's parser fix
(#77), in this worktree's isolated `STORYTREE_HOME`. The library has **seven
stories and 53 capability trees**. Its agent work-state log is empty, so the trees
are planned yellow. No health was invented for the seeded pictures.

- [Opening globe](seeded-globe.png)
- [After a pointer drag](seeded-turned.png)
- [Clicking the front island opens its story](seeded-selected.png)
- [The flat Forest, one click away](seeded-forest.png)

The following are explicitly **diagnostic copies** of that seed: two capabilities
were set to landed and reported failing in the browser input, and one capability
was claimed. These changes were never written to the seeded library.

- [A hidden failure has an edge marker; a claim appears at its tree](failure-marker.png)
- [Clicking the edge marker brings its island to the eye](failure-focused.png)

## Checks

The scratch capture instrument was borrowed from `spike/planet-look` and kept in
the ignored `apps/desktop/planet-page/dist` directory. It bundles the actual
desktop renderer, HTML and styles, replacing only Electron's bridge with reads
captured through `pageReads` from the seeded database. Its extra Three/R3F access
is capture instrumentation, not shipped page code. No new test framework ships.

The browser check verified all seven plates had ground and pine geometry; the
smoke readout named all seven stories and 53 capabilities; clicking land opened
the right panel; dragging changed the camera without selecting; wheel zoom
increased; switching Forest/Globe kept the readout; and geometry remained in
place through the turn. On the diagnostic copy, opening faced the first failure,
the hidden failure had a marker, its click faced that island, selecting the
turned island worked, the claim appeared, and a third failure arrived through
the live reading without a reload. Measurements are in [capture.json](capture.json).

There were no page exceptions or shader errors. React's development build emits
the existing drei `Html` nested-root cleanup warning when the labels remount or a
canvas is switched; it is recorded separately in the measurements. The seeded
globe is sparse at this fixed radius, with several islands nearly edge-on at its
opening turn. The plate size, radius and placement are the approved joins from
lanes A–C; this lane does not rescale them.

The committed tests cover the historical-place join and smoke readout, raycasting
through a turned scene with an opaque sea, and failure turns under an orbited
camera. A separate regression test protects the browser bundle: the agent-link
browser entry had begun traversing the Node-only merge watcher through its claims
barrel. It now exports its pure reading directly from the claims module.
