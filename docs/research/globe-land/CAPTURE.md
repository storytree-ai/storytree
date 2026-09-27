# Globe land — throwaway look, 2026-09-27

Six full desktop-page captures on `spike/globe-land`, based on main commit
`4a5a9bfea268aee27aaee7a206a9df0017e8a345`. No product source is changed; no PR,
owner-question edit or increment is made. These are alternatives for the owner's
eye, not adoption of a new placement or land treatment.

The harness is in [apps/desktop/globe-land](../../../apps/desktop/globe-land/README.md).
It borrows `spike/globe-look-2`'s `CAPTURE.md` path: the actual desktop renderer,
HTML, CSS, labels, controls and forest engine, in headless Chromium, with Electron's
bridge answered from an isolated seed through the same `pageReads` API. The
pictures are untouched 1440 × 960 PNGs, dark theme, at device scale 1. The canvas
below the app bar is 1440 × 910.4375. Chromium 148.0.7778.96 reports ANGLE / Vulkan
SwiftShader Device (Subzero); this is not an Electron desktop smoke run.

## Inputs and what changed

`pnpm seed:library` created the real seven stories, with 53 capability trees:
agent link 8, app 4, arc surface 5, command line 10, forest 7, librarian 6, library
13. The seed's activity log is empty, so all 53 trees retain their planned yellow
form. Nothing is invented in their reported health. The seed ran the existing
package checks: 318 passed, 2 skipped, 0 failed.

The separately named synthetic project repeats those capability counts across
36 stories and 273 trees. Every fourth story is planned: 68 yellow trees; the
other 205 are landed and reported passing. These fictional records exist only
in the browser input. Both sets use the same 36 frozen slots, radius, opening
bearing, camera zoom and L1 light. All original island ground, coast, shore,
relief, shadows, pines and forms come from the existing engine.

A removes the sea mesh entirely. The empty globe has no translucent shell and
writes no depth. One soft, camera-facing sprite at the origin is a placeholder
for the future core; it emits no light. It is naturally hidden when land sits in
front of it. B adds the land skin described below. C is precisely B turned 90°
around screen-up, through the page's rotation state; it changes no mesh, camera,
zoom, light rule, story or health. L1 remains the existing eye-following lamp,
including each plate's existing local light calculation.

## Fixed packed places and growth

The radius is **160 ground units**, held fixed for all six pictures. A spherical
spiral starts exactly at the front pole: for spiral parameter `t`, ground radius
`r = 72t/(2π)`, polar angle `r/160`, and longitude `t`. Each island stays a rigid
tangent plate with the engine's existing clearance; no coast or tree is resized.

The one-off measurement walks outward along that curve and chooses the earliest
non-overlapping place with a target coast gap of four ground units. It measures
the actual clipped shores, including beaches, for both inputs; the first seven
slots accommodate both sets. It allows for the spherical compression of the
unrolled coordinates. The resulting **36 directions are frozen in `slots.json`**.
The renderer reads only permanent place number, never live count, island size or
health. Adding places 8–36 or retiring a story cannot move a surviving story or
reuse a retired place. A and B share all their positions; C only rotates the
whole world.

This is a **table calibrated to these two inputs**, not a general packing rule
approved for the product. Re-running the calibration would change the table and
must not happen to an existing project's positions. New capabilities can enlarge
an island into its neighbours. These narrowly spaced places do not inherit W2's
100-story / 19-capability clearance proof. Place 37 is explicitly refused in the
look; no future capacity policy has been decided.

| Input | Nearest-coast gap: minimum / median / maximum | Last centre from the front pole |
| --- | ---: | ---: |
| Seven seeded stories | about 4.29 / 4.39 / 7.73 units | 41.02° |
| 36 synthetic stories | about 4.12 / 4.44 / 7.68 units | 109.68° |

The gaps are shortest great-circle distances among the radially projected,
clipped coast vertices before vertical relief; see [spacing.json](spacing.json).
They are sampled geometry measurements, not an exhaustive collision proof for
arbitrary story ids or future sizes. “Nearest” matters: every story has a close
neighbour, but the unequal coast shapes still leave wider bays and open spaces
between spiral turns. A's pictures show those spaces honestly.

As stories arrive, the occupied patch grows outward rather than redistributing
around the entire globe. Old centres and mutual distances never change; a new
story can become an old story's closer neighbour. On the outer turns, east-west
spacing compresses: at the 36th centre, `sin(angle)/angle` is about 0.49. The
measured table skips farther along the curve where necessary to avoid crowding.
A fixed sphere cannot sustain this indefinitely. Retirements leave empty slots;
the prototype's enclosing land skin may still span such a hole.

## B's simplest land fill, and its cost to the shore look

B draws **one opaque, double-sided mesh** beneath the existing islands. It takes
the convex envelope of their actual coast polygons in azimuthal coordinates,
samples a two-unit grid inside that envelope, and maps it back around the sphere.
In gaps it interpolates the nearest shore heights; beneath an island it lowers
the skin below the island's relief. It is one plain muted olive material under
the same L1 sun. There are no bridges, paths, trees, parcels or story semantics
in this added mesh.

This is the **convex envelope, not a precise polygon union or a new sculpted
coast**. It intentionally fills both narrow gaps and the broad interior bays,
and can create wide plain areas. The boundary is a coarse grid approximation.
At seven stories the skin adds 20,476 triangles; at 36 it adds 142,512.

It does fight the old coast/shore reading. Each story still has its own beach,
shore dip and skirt, now inland, so it can look like a raised garden or a plate
on a common base. The new outside edge is blunt and lacks the engine's beach;
simple height interpolation leaves ridges/seams visible in B. The flat plates
also diverge from the curve most visibly at the horizon. This is enough to show
connected land and the possibility of later trails, not a finished continuous
terrain or a trail implementation. A proper common outside shore and quieter
internal region boundaries would require an owner-approved change to that look.

## Transparency and reading the sides

A has no complete globe silhouette. Seven stories read mostly as a forest patch
floating in space. At 36, the outward-pointing rim trees suggest a ball, but
far-side branches show through gaps and overlap nearer coasts. The viewer gets
less help distinguishing a near region from a far one. Existing labels still
face the camera and obey scene occlusion; they do not themselves encode depth.

B restores a curved silhouette only where there is land. Its near land naturally
occludes the far side; its empty side remains fully see-through. In C, the centre
glow supplies an interior reference at seven stories and the land can be seen
from its inside as well as outside. At 36 stories, the continent extends beyond
a hemisphere and still hides the centre glow after the quarter turn: transparent
empty space alone does not ensure that a future core will be visible. Its far
underside shows as plain land through the open side. The seven-story C has three near centres, three far centres,
and the original pole on the horizon. The double-sided plain skin can hide the
underside of a far story's coloured ground, while its outward trees remain
visible beyond the edge. Seeing through empty space does not guarantee every
far-side story remains readable through opaque land.

Dense labels and trunks at the horizon are particularly hard to separate in the
36-story views. No new near/far fade, outline, sorting treatment or failure-marker
policy is implied by these pictures. The existing failure markers still use
hemisphere position; their interaction with visible far-side stories would need
separate product consideration if this look were pursued.

## Draw calls and checks

Counts come from `gl.info.render` for one explicit settled main-scene frame,
including the placeholder glow, excluding one-time light calibration and HTML
labels. These are submitted draws/triangles, not a frame-rate claim. Opaque land
can hide an island's pixels without eliminating its draw submissions.

| Picture | Draw calls | Submitted triangles |
| --- | ---: | ---: |
| A, seven | 43 | 460,740 |
| B, seven | 44 | 481,216 |
| C, seven | 44 | 481,216 |
| A, 36 | 190 | 3,018,674 |
| B, 36 | 191 | 3,161,186 |
| C, 36 | 191 | 3,161,186 |

B's fill costs one draw call in these views. C changes no batching. The dense
forest geometry remains the bulk of the submitted triangles; the transparent
empty space is not itself a rendering layer.

Per-picture JSON stores the actual camera, world rotation, plate geometry,
material sides, smoke readout, draw counts and browser messages. All expected
stories and capability trees were present, with ground and pine geometry. No
sea object was present; the centre placeholder was present in every case. The
same story geometry and local positions were checked across A/B/C, and the
quarter turn was checked numerically. All six PNGs were visually inspected.

Every seed, geometry measurement, render and Playwright run held the shared
`/tmp/storytree-heavy.lock`. There were no page exceptions, shader errors or
missing assets. The existing Three.Clock deprecation, React/drei nested-root
cleanup warning and SwiftShader readback warnings are recorded. The first C/36
screenshot exceeded Playwright's default 30-second capture timeout; it was
recaptured with a 180-second screenshot deadline. No new product tests or testing
framework were added for this look.

## FOR THE OWNER

The pictures test the owner's new packed-land direction and intentionally reverse
W2's even distribution. They do not settle that choice. B connects the forest
cheaply in draw calls, but its inland beaches and plain outside edge expose the
cost of preserving the old islands untouched. C makes the transparent space
clear, and also shows why near/far legibility remains a separate question. The
laptop session can record the owner's response; this spike changes no decision,
question or increment.
