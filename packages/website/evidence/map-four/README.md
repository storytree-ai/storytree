# The map chapter in four steps

ADR-0891, owner-approved amendment of 7 October 2026. Website contract 2.16; increment_a82194980f51 and the 320px framing repair, increment_c25632b34d1e.

The four steps use the exact approved lines. The seven-step chapter's separate parts, code and Orders steps are gone. The agents, knowledge and ending chapters retain their content and recorded views.

| Step | See | Feel / think |
|---|---|---|
| 1 · The beginning | The shop's empty globe swells, then its four planned islands appear faintly. | A small project I can follow from its beginning. |
| 2 · A story, its capabilities, its code | Signing in's land appears in recorded capability-landing order, then file dots; the real story panel opens on line four above 600px. | I can connect the words, the island, the code and the capability tree. |
| 3 · Pathways | Browsing, the cart and Checkout are built in their recorded parallel work interval. Their pathways connect them to Signing in, and the cart and Checkout to Browsing. All four named islands remain visible. | The dependencies show why these pieces belong together. |
| 4 · Health | Checkout changes from the recorded untested yellow to verified green; the other three remain in view. Browsing is green when its recorded capabilities are green. The sourced comparison is under this step. | The colour follows evidence from CI. |

`1920-*.png`, `1440-*.png`, `1280-*.png`, `390-*.png` and `320-*.png` show every step at 1920×1080, 1440×900, 1280×800, 390×844 and 320×700. `1440-story-panel.png` also shows step 2's capability drill-down. `1440-steps-1-to-3.webm` plays the first three steps at the tour's default 0.75×. Captured from the local build with Chromium/SwiftShader. Still captures hold each beat near its end to let the final scene paint; the clip plays continuously.

The captures include the pathway repair in PR #827: their build stamp is base commit `8f5c66c29ab2169490041ebb4d4eb56c0b5235fa`, with this PR's unpublished website changes applied. The pictures and journeys were regenerated after taking that update. Shared-machine timing is not a controlled performance benchmark.

`1440-health-yellow.png` also catches Checkout untested at the beginning of the health replay; the settled health pictures show its later green result. Browsing is green in both.

The first PR's saved code survey supplies file sizes and allocation. Its capability-landing events (01:56–02:00) supply the reveal order; the replay does not invent an intermediate code survey. Each stage draws its own land and statuses, avoiding later capabilities masking Browsing's recorded health. The map's window ends at the first CI confirmation (03:08); the other four islands remain available in free play.

`framing.json` records every named island against the header, narration, controls and story panel. Island bounds are estimated from the name and drawing size; the actual pictures were also visually reviewed. The 320px repair gives the pathways and health steps an explicit view centred on Browsing: they no longer inherit the preceding Signing in close-up. On 320×568, step 2 also uses 18px of spare space above the controls so all four lines and How and why fit without scrolling.

Renderer residue is recorded as increment_cd32de08d711 on the owning arc: the brief asks for agent-coloured coasts, while the current renderer implements ADR-0923's capability outlines and exposes no coast-colour switch. The website still supplies the recorded sessions. No renderer code changed. Drawing pathways along their length remains increment_8be62aa1abe9, left to its engine lane.

Reproduce after building:

```sh
node packages/website/evidence/arrival/capture.mjs --only mapSteps --to map-four
node packages/website/evidence/capture.mjs map-four/journeys --verify-tour
node packages/website/evidence/capture.mjs map-four/journeys --verify-camera
node packages/website/evidence/capture.mjs map-four/journeys --verify-immersive
node packages/website/evidence/capture.mjs map-four/journeys --verify-opening
node packages/website/evidence/arrival/capture.mjs --check
```

The exact-copy and recorded-growth unit checks were witnessed red then green. The browser framing check exposed the inherited close-up, and the immersive journey exposed the 14px short-phone overflow before their fixes. Journey observations are retained in `journeys/`.

Validation after integrating PR #827:

| Check | Result |
|---|---|
| `pnpm gate`: typecheck | PASS |
| `pnpm gate`: website tests (67), package boundary and numbered-source allocation | PASS |
| `pnpm gate`: plan edges | PASS |
| Guidance | NOT RUN — no role or supporting-note change |
| Browser tour, camera, immersive and opening journeys | PASS |
| Full `arrival/capture.mjs --check` | PASS |
| Five-width map framing | PASS — 20 captures, zero misses |

All 20 step stills, the story panel and the additional yellow-health frame were visually reviewed. The 76.08-second clip was inspected at representative moments. The full arrival observation retains its measured frame rates; those shared-machine SwiftShader readings are observations, not a performance acceptance claim.
