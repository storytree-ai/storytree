# Planet look spike — 2026-09-27

Throwaway evidence for `0-3-planet-spike-look` and
`oq-0-3-planet-first-slice`. This branch is never a PR or a landing.

The five real story files are read by the same parser as `pnpm seed:library`,
then passed through `forestScene` and the ported `forestDescriptors` engine.
The fresh seed has no agent work-state or reported-health entries, so its trees
wear the existing planned/building yellow. No health is invented for this set.

The look test places each unchanged island mesh on a tangent plate, using a
temporary wrapped spiral. Placement here is an instrument, not lane A's rule.
Each comparison keeps the flat reference and globe at the same pixels per
ground unit. The 36-story set is explicitly synthetic.

The instrument is in `apps/desktop/planet-look/`. Build with
`node --import tsx apps/desktop/planet-look/build.mjs`, serve with
`node apps/desktop/planet-look/serve.mjs`, then capture with
`flock /tmp/storytree-heavy.lock node apps/desktop/planet-look/capture.mjs`.
The capture script accepts picture stems to rerun a subset. `PLANET_PLAYWRIGHT`
and `PLANET_CHROMIUM` can point at other locally installed browser tooling.
On this machine, first compile the process-local hardware-probe guard:
`cc -shared -fPIC -Wall -Wextra -o apps/desktop/planet-look/dist/no-hardware-gpu.so apps/desktop/planet-look/no-hardware-gpu.c -ldl`.
Chromium otherwise blocks in `drm_open` even with SwiftShader and `--disable-gpu`.
The guard denies `/dev/dri/*` and `/dev/nvidia*` opens only inside the capture
browser. The recorded WebGL renderer identifies ANGLE / SwiftShader (Subzero).

## Mounting findings for lane B

The only change to the existing canvas file is five lines exposing `CellGround`,
`KitProps` and `SHIPPED_GROUND_INPUT` under spike names. The scratch `Plate`
component owns one `createGroundInputCache` and one growth texture, and mounts
those two shipped components. It centres an island before `forestDescriptors`,
then puts the result under a translated, rotated group. The kit loader stays a
shared singleton; the ground and owned kit material clones stay per plate.
Camera, sea, colour settings, controls and the calibrated light pair belong to
the outer Canvas. Each side of a comparison has one Canvas; the globe never
creates a Canvas per island.

Simply adding groups is insufficient:

- `banded-ground-material.ts` samples paint, grain, shore, wear and occlusion
  through `vWorld.xz`; its cliff/rock logic assumes y is up. After moving the
  plate these would swim, detach or call a level island a cliff. The spike patches
  the material instance so position and normal stay in island coordinates, and
  transforms the sun into that same frame. Geometry and paint recipes are intact.
- Three lights are scene-wide. Placing one directional light inside each group
  lights every island with every sun. L2 instead adds a direction uniform to each
  owned kit material, preserving its existing tint, prop-lighting and growth
  hooks. One calibrated light supplies the intensity. Its direction is expressed
  in view space for the kit and plate space for the ground.
- L1 derives the world sun from the camera quaternion every frame; L3 retains
  the initial world sun. L2 rotates the original sun with each island.
- The shadow atlas already contains cast shadows from the original local sun;
  rotating `uLightDir` does not rebuild it. Rock skirt colour rows also encode
  the authored sun. These remain frozen in this bounded look test. A production
  implementation needs a deliberate treatment of both, not just light uniforms.
- The existing flat shader uses half-Lambert banding and an ambient floor.
  Keeping that treatment does not produce a physically black night side.
- A sphere touching the y=0 plate datum cuts through negative terrain relief.
  The spike uses 1.692 ground units of clearance (the maximum relief bound plus
  0.1), leaving the existing skirt to dip toward the water. This is essential:
  the first picture without clearance had dark triangular holes through land.
- The land has no bottom cap. At the silhouette its very thin plate and outward
  trees are exposed. The larger project makes this much easier to see.
- Centring the descriptors before building them follows the increment, but the
  existing relief/cover fields sample coordinates. A local rebuild therefore
  changes their phase from a globally offset flat island; it preserves the
  engine's recipes, not every flat reference pixel. Merely translating an
  already-built flat mesh would have a different sampling policy.
- Names need an explicit stable HTML portal outside the Canvas's DOM host in
  this scratch page; the first name disappeared when Drei appended into that
  host while the Canvas was mounting. The final five-story frames carry all
  five names on the flat side; names behind the globe are occluded.
- This checkout's forest root barrel reaches an unrelated Node-only merge
  reader. The scratch bundle aliases that barrel to the pure forest-scene entry
  it actually needs. No agent-link or app code was changed to serve the spike.

## Pictures

All comparisons use the same orthographic scale on their two sides. Five-story
frames use **1.344686 px per ground unit**, zoomed out enough to see the globe.
The 36-story frame fits the complete flat forest at **1.015065 px per ground
unit** and applies that scale to the globe too. The rim study uses the five-story forest's actual resting scale,
**3.196225 px per ground unit**, at device pixel ratio 1.

- [L1, light follows the eye](own-l1.png): five islands on one face.
- [L2, every island retains its own light](own-l2.png): the same pose, with the
  islands retaining their local light direction toward the edge.
- [L3, fixed sun, 0 degrees](own-l3-000.png): the initial L1 sun and pose.
- [L3, fixed sun, 90 degrees](own-l3-090.png): the islands turn toward the rim.
- [L3, fixed sun, 180 degrees](own-l3-180.png): the five islands are behind the
  opaque sea. A blank face here is occlusion, not evidence of a dark hemisphere.
- [36 synthetic stories under L1](synthetic-36-l1.png): 267 capability trees;
  fictional states and repeated capability-count patterns from the real files.
- [Library rim at resting scale](library-rim.png): the biggest island, 13 trees,
  seen flat and edge-on, with a cyan measurement line.

The fresh seed's absence of agent activity leaves all 37 real trees planned;
the seed's verified test reports do not change the forest's reported/work-state
appearance. Stable ids come from the five filenames, rather than fresh database
UUIDs, so individual coast seeds need not match a particular installed database.

## Rim measurement

The largest rendered mesh footprint is the library, **51.581832 ground units**
from its own origin. The sea radius is **210**, and the plate datum is **211.692108**
from the globe centre. The curvature-only radial rim lift is
`hypot(211.692108, 51.581832) - 211.692108 = 6.193720` ground units.
At resting scale this is **19.8 pixels**. Clearance adds **5.4 pixels**, giving
**25.2 pixels** from the nominal plate rim to the water in the edge-on study.
This explicitly excludes the local terrain relief and hanging skirt; it is a
datum measurement, not a claim that every visible coastline gap is 25 pixels.
The study aligns the widest rim with the screen plane, so the reported radial
distance is also its projected length. The general comparison poses foreshorten it.

At the wider five-story comparison scale, the largest projected datum-to-water
gap for the library is **6.2 pixels**. The resting scale and comparison scale
must not be mixed when discussing this result. The temporary radius and wrapping
are not a spacing or capacity recommendation; lane A owns those measurements.

## Validation

`pnpm --filter @storytree/forest-world typecheck` and the standalone browser build
pass. The capture waits for every kit mount and several complete frames, refuses
browser/shader errors, and stores a JSON sidecar for each picture. A 90-degree
eye orbit additionally checks that L1 changes its world light but holds its view
direction, while L2 and L3 hold their world directions for the unchanged plate.
The ground build revision remains unchanged during that orbit.
The five real-story flat reference panels are also pixel-identical, and the L1
and L3 globe pixels match at their shared starting pose. Every L2 island's
recorded local sun matches the original direction. The starting frames contain
all ten names across their two panels.

There are two canvases per comparison, one for each side. The five-story globe
draws in 31 calls including the sea, versus 6 for the merged flat forest. The
36-story globe uses 198 calls versus 16 flat;
these are scene observations, not hardware timings. Per-island merging means
more draws and per-island atlases; the shared kit is still decoded only once.

No new product behaviour or test framework is introduced. This is a visual
instrument with browser checks, held on a throwaway spike branch for the owner.
The owner still chooses H and L. L1/L3 would need a deliberate production
treatment of the baked shadows, skirt shading and ambient floor before anyone
promises the full moving-sun/day-night behaviour in the question.
