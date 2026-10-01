# An animating globe reuses its shader programs every frame (ADR-0836 D1)

**What it shows.** The actual desktop page (`build.mjs <checkout> <out>`: the renderer bundle plus a probe exposing
the canvas state), over the library-dots-clickable seed with two running sessions that have each opened six notes,
so the knowledge core's glow animates and their islands are tinted. `measure.mjs <out> <prefix> forest|library <s>`
counts, over 3 s of frames, how often three.js re-derives a shader program (each `getProgram` calls the material's
`customProgramCacheKey`, which the instrument wraps, by material) and how many GPU buffers are created; then it times
`gl.render` and CPU-profiles the page for `<s>` seconds. `STILL=1` renders one still frame under reduced motion.
Headless Chromium on the Mint box with software GL: compare relative, same box, same instrument.

**Cause.** Three draws a see-through, double-sided material in two passes, back faces then front, setting
`needsUpdate` before each, so every such object re-derived its program twice a frame. On the globe that is every
island's ground and coast, every pathway halo, territory, claim outline, file circle, coast tint, the selection ring
and the glass. Separately, the core's moving lines called `setPositions`/`setColors` every frame, each making new
GPU buffers.

**Forest view (the default), three runs each, 20 s:**

| | programs re-derived / frame | `gl.render` ms / frame | page idle | `getParameters` share |
|---|---|---|---|---|
| before (main 73f1f4c) | 70 | 4.16, 4.23, 4.59 | 90.3-91.0% | 1.0-1.1% |
| after (flat marks one pass, glass as two fixed-side groups) | 0 | 2.74, 2.93, 3.30 | 92.7-94.0% | 0 |

**GPU buffers created per frame** (library and forest view): about 5 before, 0 after the lines move in place.
Library view had no program re-derivation before (no land drawn) and its render time is unchanged (1.6 ms).

**Pictures.** `before.png` and `after.png` are the same still forest scene (glass, islands, coasts, pathway halos, a
session's selection ring and coast tint, the core's trails), rendered by each build: pixel-identical (difference
bounding box empty). The laptop's scene has many more islands and territories, so its count per frame is larger.
