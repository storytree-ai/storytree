# Forest render contracts on the actual page

Increment `increment_05f91c159f48`, refreshed 2026-10-02. The existing capture now
runs named Node tests for forest 3.5, 3.9 and 3.10, and emits machine observations
for `pnpm record:acceptance`. Pointer hover and the five-CSS-pixel drag threshold
(3.12) run in the ordinary suite in `../../planet-view.test.ts`.

Increment `increment_c5580ace0978` also names Knowledge core 1.7 in four browser
tests: each switch, in both directions and at both angles, submits all 176 eligible
points at unchanged positions, computed depths and shelf membership, and preserves
the live point-layer identity. The fixture includes both shelf and no-shelf points.
These existing behaviors are retained, not retired. `knowledge-observations.json`
records their acceptance checks for **The knowledge core**, separately from the
forest's results; record it with the same acceptance command below.

Increment `increment_e56b2e0106d1` adds the first-window panel journey in the same
runner. A browser-only copy of the snapshot keeps the Forest story and its first
five capabilities, makes those capabilities independent and proposed, and opens
the island through an actual pointer click at **1380 × 970**. No library fixture is
changed. The journey measures every card and its effective on-screen title and
health font sizes before testing 4.9 (natural card size), 4.11 (whole tree in the
panel without pop-out), and 4.8 (selecting another capability).

The baseline is retained in [the before capture](panel-first-window-before.png)
and [its measurements](panel-first-window-before.json): five cards occupy 9.27%
of the 439.625 × 352 frame; each card is 79.664 × 36.002 pixels, its title 4.7875px
and its health word 3.83px. The new natural-size assertion failed on that renderer.
Under **Legible at the resting view** (`principle_1e3418812c33`), the baseline fails:
the status colour is present but the titles and health words cannot be read at rest.
**The resting view is designed, not fitted** (`principle_43ea5d4f68c4`) supplies the
measured target: all five cards fit at 208 × 94 pixels, preserving 12.5px titles,
10px health words and 10.5px health reports without the larger-window control.

The [after capture](panel-first-window.png) and [measurements](panel-first-window.json)
show five 208 × 94 cards in the same frame at scale 1: two columns, three rows,
occupying **63.17%** of the frame. Titles are 12.5px, health words 10px and reports
10.5px. All cards fit before any pan, zoom or pop-out, and another card selects
through its real pointer target. By **Legible at the resting view**, the labels,
proposed words, report/verification wording and selected outline are distinguishable
in this capture. The larger-window icon occupies the unused right end of the top
right card's strip; it covers no status word. These are observations of this seeded
window, not an owner acceptance or a claim about every tree shape.

| Check | Observed |
| --- | --- |
| 3.5 glass | At least 81.96% background transmission across the inner disc, a brighter rim, one soft highlight, no opaque sea |
| 3.9 Forest | Eight story islands and 176 eligible knowledge points submitted at both angles |
| 3.9 Library | Zero story islands; only the same 176 eligible knowledge points |
| 3.10 switching | Canvas, scene, camera and point-layer identities, rotation, zoom and point positions survive both switches |
| 3.10 interaction | Library clears the story selection and panel; hidden islands cannot be selected; real pointer drag and wheel zoom work; reload defaults to Forest |

The glass test measures actual shader pixels against black and white. Their
difference gives transmission through both faces, without duplicating the shader
formula. It samples the brighter rim and counts connected bright regions and their
intensity levels to verify one soft highlight. See `glass.json`.

The original read-only snapshot remains the input (`seed.json`). The current
placement API excludes story-description definitions from the visible points:
77 are on shelves and 99 have no shelf. `measure.mjs` computes the expected census
through the current public API, including the globe's grown radius. `capture.mjs`
compares that census to actual geometry and temporary renderer-submission counters.
Submission does not claim that every point occupies an unoccluded pixel.

[Forest front](forest-front.png), [Forest turned](forest-quarter-turn.png),
[Library front](library-front.png), [Library turned](library-quarter-turn.png).
The accompanying JSON records retain the geometry, renderer and identities.
The synthetic interaction fixture uses a verified unhealthy capability and its
current health word, dismisses the first-run guide through its Close control,
and selects the Forest/Library buttons within their named group.

Reproduce from the checkout root (installed Playwright Chromium, or
`CAPTURE_CHROMIUM`; `CAPTURE_PLAYWRIGHT` can name a different Playwright module):

```sh
node --import tsx packages/forest/src/view/evidence/forest-library-toggle/measure.mjs
node packages/forest/src/view/evidence/forest-library-toggle/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/src/view/evidence/forest-library-toggle/capture.mjs
```

The default capture writes into `/tmp/storytree-captures/`; `--retake` explicitly
replaces this evidence. Record its generated `observations.json` with
`pnpm record:acceptance <path>`. An incomplete journey adds not-observed checks,
so partial success cannot certify a whole contract. Browser and server close in
`finally`. No library writes happen during capture.

These browser tests run explicitly on the Mint box; regular CI has no browser
provisioning and does not run them. The existing acceptance recorder writes their
verified results. No skipped placeholder test is added to CI. This is browser
renderer proof; it makes no laptop or Windows installer claim.
