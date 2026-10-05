# Globe drawing · lane B

`PlanetWorldCanvas` is the browser entry at `@storytree/forest-world/planet`.
It accepts the existing `ForestScene`, a `ReadonlyMap<storyId, { x, y, z }>` of
unit directions and the placement rule's fixed `radius` in ground units.

Each island is centred before `forestDescriptors` builds it; its clipped coast then becomes one
flat, pale, see-through surface with a coast band (`island-surface.ts`, ADR-0804 D1), bent onto the
globe's sphere under a rigid tangent group. There is no ground colouring, no pines or plants, and so
no kit to parse and no sun to calibrate. There is one orthographic canvas. Plates own and dispose
their surface geometry. Drag orbits the camera; wheel/pinch zooms. Rendering runs on demand, and only
while some of the canvas is on screen (6.10, `paint-while-seen.ts`): off screen the frameloop stops,
keeping the scene, camera and clock, so a host can mount the globe below the fold for free. The
`kitBytes` prop is gone.

`plateChildren(island, descriptors)` puts the page's names, selection and claim
markers in the plate's local coordinates. `parcelSpots(descriptors)` and
`islandAt(descriptors, x, z)` therefore use those local coordinates too. Other
R3F `children` can read the default orbit controls. The optional `rotation`
quaternion turns the globe as a whole for host-driven focus. The page, its
selection handling and its failing-story markers are lane D's work.

L1 (ADR-0646) kept the flat forest's lamp fixed relative to the eye for the ground and the kit;
ADR-0804 removed both, so only the glass ball's highlight still follows that lamp. Clearance of 1.692108 ground units keeps
the plate's origin above the shell (so the flat surface rests on it). ADR-0648 replaces the opaque sea with a light grey
transparent shell, tuned after #93 at the owner’s request to read as glass. The same
sphere uses a small shader: 0.012 base opacity, a Fresnel rim and a single soft
highlight from L1’s view-space lamp, without a transmission buffer or refraction. Since ADR-0919
the ball is a one-way mirror: the near face is that see-through glass, writing no depth, and the far
face is solid, painting the bowl's backdrop (`FAR_WALL_COLOUR`) and writing depth, so nothing on the
far side shows through while the core inside does. Each island's ground likewise has a depth-only
copy just under it (`ISLAND_DEPTH_INSET`), drawn from outside only, so a facing island hides what
lies behind it and an island seen from behind hides nothing. The shell still answers rays, so the
page keeps its near-side names, claims and picking rule. The surface owns and disposes its
geometry and material.

The flat canvas keeps its camera, controls and material defaults. Existing
tests were left unchanged. A comparison against the red commit's shipped
ground material also found byte-identical vertex and fragment shaders with
the shipped grass, wheat, blight, rock and detail layers and no plate option.
Centring a globe island changes the phase of coordinate-sampled terrain and
cover compared with its offset flat counterpart, as the look spike reported;
the geometry and paint recipes are reused unchanged.

## Historical first-slice capture

The seed at green commit `0967c43` produces six stories and 43 capability trees: the
agent link, app, arc surface, forest, librarian and library. The fresh seed
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

- [Opening view beside the flat canvas](evidence/seeded-globe.png)
- [After dragging, zooming and turning](evidence/seeded-globe-turned.png)
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
