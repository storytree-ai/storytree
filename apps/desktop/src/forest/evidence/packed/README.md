# Packed islands on a see-through grey ball

ADR-0648, increment `0-3-planet-packed-see-through`, 2026-09-27.

Renderer: **headless Chromium 148.0.7778.96, ANGLE / Vulkan SwiftShader Device (Subzero)**.
Untouched 1440 × 960 PNGs, dark theme, device scale 1. This is the actual desktop page,
with its HTML, styles, renderer and forest engine. Electron's bridge is answered by
`pageReads` from a fresh, isolated `pnpm seed:library` in this worktree. The seven stories
have **53 capability trees**, all planned yellow: the seed's work-state log is empty and
its reported health was not changed.

- [Seven seeded stories, opening view](seeded-packed.png)
- [The same seed after a quarter turn](seeded-quarter-turn.png)
- [36-story sample](sample-36.png) — explicitly synthetic; the seed's counts repeated,
  with every fourth story planned and the others landed and reported passing, as in the spike.

The world contains a radius-160 light grey shell (`#bfbfbf`), opacity 0.18, double-sided,
with depth writing off. There is no sea, filled continent, bridge or placeholder core.
The ground, beaches, trees and L1 light remain the existing engine's. The shell answers
rays to preserve the existing label/claim occlusion and near-side selection rule. At the
horizon, labels above the surface can remain visible beyond the silhouette, as before.

The capture retains the spike's radius, spiral pitch and capacity, but **corrects its table
before first landing**. The spike's original seed passed; this fresh seed's different ids
made places 1 and 2 overlap. A second committed red/green pair captures and fixes that
incident. The final 36 directions were measured against both seeds and the 36-story sample,
then frozen. Nothing repacks in response to live story counts, ids, retirement or growth.

The original seed, fresh seed and 36-story sample all pass the complete coast-edge and
containment check, including beaches. Fresh-seed nearest coast-vertex arc gaps run from
4.22 to 10.84 ground units, median 4.44. See [spacing.json](spacing.json) and the
[bounded proof](../../../../../../packages/forest/src/planet-places/measurements.md).
This is not a guarantee for arbitrary ids or future island growth, and does not inherit
W2's 100-place/19-capability bound. Place 37 is refused.

## Interaction proof

The following pictures use a **diagnostic browser copy** of the seed, with one capability
in the forest and one in the library landed and reported failing, plus one Codex claim.
None of those diagnostic records was written to the seeded library.

- [Failures on the far side remain reachable at the edge](failure-hidden.png)
- [Clicking the marker faces the failure; selecting it opens its panel, with its claim](failure-focused.png)

The browser check verified opening toward the first failing story, claim text, land picking,
dragging without selection, wheel zoom, hidden-failure markers after turning away, marker
focus after orbiting, picking the newly focused island, and switching to the flat forest
and back with all seven stories and 53 trees in the smoke readout. The far-side picture
also shows the existing one-sided ground's undersides and trees through the shell.

Measurements: [opening](seeded-packed.json), [quarter turn](seeded-quarter-turn.json),
[36-story sample](sample-36.json), [interactions](interactions.json). The opening submits
44 draws and 487,748 triangles, including both shell faces. Counts are not frame timings.
All expected plates have ground and pine geometry; no sea or core object is mounted.
There were no page exceptions, asset errors or shader errors. The existing Three.Clock
deprecation, drei nested-root cleanup and SwiftShader readback warnings are recorded.

The scratch instrument was copied from `spike/globe-land` into this directory's ignored
`dist/`. Its build adds only observation hooks for Three/R3F state and the page's rotation
setter; it substitutes no product placement, material, mesh or light. Its export reads the
isolated database through `pageReads`. No new test framework ships, and the spike was not
merged. Every seed, render, Playwright run, typecheck and test held `/tmp/storytree-heavy.lock`.
The laptop session adds the owner's Electron `pnpm desktop:smoke` capture.

Red `dc6cca9` failed four checks before green `67754f7`. The fresh-seed coast regression
failed at red `f901293`, then passed with the corrected frozen table at green `58d7215`.
`pnpm typecheck` and the full `pnpm test` pass: 1,834 passed, two skipped, zero failed.
