# Globe drawing · lane B

`PlanetWorldCanvas` is the browser entry at `@storytree/forest-world/planet`.
It accepts the existing `ForestScene`, a `ReadonlyMap<storyId, { x, y, z }>` of
unit directions, the placement rule's fixed `radius` in ground units, and the
same exported pine `kitBytes` as `ForestWorldCanvas`.

Each island is centred before `forestDescriptors` builds it, then the existing
`CellGround` and `KitProps` draw it under a rigid tangent group. There is one
orthographic canvas, one calibrated ambient/directional light pair and one
parsed kit. Plates own and dispose their ground textures and kit material
clones. Drag orbits the camera; wheel/pinch zooms. Rendering runs on demand.

`plateChildren(island, descriptors)` puts the page's names, selection and claim
markers in the plate's local coordinates. `parcelSpots(descriptors)` and
`islandAt(descriptors, x, z)` therefore use those local coordinates too. Other
R3F `children` can read the default orbit controls. The optional `rotation`
quaternion turns the globe as a whole for host-driven focus. The page, its
selection handling and its failing-story markers are lane D's work.

L1 (ADR-0646) keeps the flat forest's lamp fixed relative to the eye. Each
plate inverse-rotates that world direction into its ground shader; the kit
uses the same world sun through Three's ordinary directional light. At the
flat forest's viewing angle relative to a plate, its local light is the
original `LIGHT_DIRECTION`. Paint, terrain slope and atlases stay in plate
coordinates. The baked shadows and skirt colours stay as approved; they do
not become a moving-sun simulation. Clearance of 1.692108 ground units keeps
negative relief above the opaque sea.

The flat canvas keeps its camera, controls and material defaults. Existing
tests were left unchanged. A comparison against the red commit's shipped
ground material also found byte-identical vertex and fragment shaders with
the shipped grass, wheat, blight, rock and detail layers and no plate option.
Centring a globe island changes the phase of coordinate-sampled terrain and
cover compared with its offset flat counterpart, as the look spike reported;
the geometry and paint recipes are reused unchanged.

## Capture

The current seed parser produces six stories and 43 capability trees: the
agent link, app, arc surface, forest, librarian and library. The fresh seed
has no agent work-state entries, so the planned trees wear the existing
yellow. The capture uses those story files through `parseStory` and
`forestScene`, with stable filename ids rather than a particular database's
UUIDs. No health or synthetic stories are added.

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
