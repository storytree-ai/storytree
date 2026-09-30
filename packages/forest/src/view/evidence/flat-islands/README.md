# Flat islands: no pines, plants or land colouring (ADR-0804 D1)

Increment `increment_efb683ea8e6c`, arc "Code islands". Each island is now one flat, pale,
see-through surface with a coast line, bent onto the globe. The pines, the plants and the banded
land colouring are gone. This is a picture for the owner to judge; nothing here is recorded as
accepted (ADR-0794).

| View | Picture | Before (same seed, `../knowledge-under-islands`) |
| --- | --- | --- |
| Resting view | [front.png](front.png) | [production-front.png](../knowledge-under-islands/production-front.png) |
| Close-up (camera zoom x2.6) | [close-up.png](close-up.png) | |
| Quarter turn | [quarter-turn.png](quarter-turn.png) | [production-quarter-turn.png](../knowledge-under-islands/production-quarter-turn.png) |

Renderer: **headless Chromium 148.0.7778.96, ANGLE / Vulkan 1.3.0 SwiftShader**, 1440 x 960, dark
theme, device scale 1. The seed is the committed eight-story, 58-capability snapshot of the
knowledge-under-islands capture, so the two sets compare one to one. Turns and zoom are set by the
script (`capture.mjs`), never panned by hand. `build.mjs` bundles the actual desktop page with two
observation hooks; run both under `flock /tmp/storytree-heavy.lock`. Counts are in
[measurements.json](measurements.json).

## Measured before looking

- Objects on each plate: **1 ground surface + 1 coast band** per island, 8 islands; **0** pine, prop,
  kit or tree objects (before: 48 meshes on the plates, 524,850 triangles of ground and pines).
- Ground triangles across all eight islands: **6,420** (whole frame 60,746 triangles and 145 draw
  calls, before 566,436 and 161).
- Every ground and coast vertex lies on the sphere the plate rests on (worst gap 1e-6 ground units):
  the surface is conformed to the globe, not a tangent plane.
- The ground material is one colour (`#edf3f5`), opacity 0.4, `transparent`, `depthWrite` off, no
  vertex colours. The coast band is 0.9 ground units wide (about 1.6 px at rest).
- Clicking the front island still selects its story and opens its panel.
- No page errors. One Three.Clock deprecation warning, as before.

## What the pictures show, and the principles they are held to

- **Meaning outranks appearance / a connector must connect.** The knowledge points beneath the
  islands stay visible through the surface (front.png, close-up.png), because the ground writes no
  depth and is 40% opaque, so a line diving through it into the core will show. The cross-island
  trails still meet each coast.
- **Legible at the resting view.** Each island reads as a pale-grey shape with a lighter coast line
  and its name; all eight are distinct at rest. The grey is dull rather than bright against the dark
  sea and the shell's glow: a judgement for the owner (ADR-0804 asks for "pale"), and one number
  (`ISLAND_GROUND_OPACITY`) moves it.
- **The resting view is designed, not fitted.** Unchanged: placement, names, glass ball and trails
  are as before. Only what stands on the plate changed.
- **Not decided here (ADR-0804 D6).** No stand-in for the pines' test-health signal: a failing
  island is still marked by the page's edge marker and name, not by its surface. The wisps and the
  worn on-island paths are untouched by this increment, except that the ground the wisps orbited
  is now flat, and the on-island worn paths (drawn into the old ground) are no longer drawn.
