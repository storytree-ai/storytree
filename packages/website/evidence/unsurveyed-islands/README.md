# Unsurveyed islands show recorded progress

2026-10-03, Mint box, increment_feb09b12a50d, Forest contract 3.29.

Conduit's saved planned islands show `0 / 1 landed` with empty neutral meters. In the saved frontend stage, the same five stories show `1 / 1 landed` with full meters. The intermediate part1 stage changes only Discover articles. Each count comes from the saved capability forms; the frontend forms retain `status: untested`. Landed work does not become verified health.

| Saved stage / actual tour step | Desktop, 1440×900 | Phone, 390×844 | Complete label boxes inside globe, desktop / phone |
| --- | --- | --- | --- |
| planned / Roads | [Picture](1440-planned.png) | [Picture](390-planned.png) | 5 / 5 |
| part1 / Contracts | [Picture](1440-part1.png) | [Picture](390-part1.png) | 4 / 2 |
| frontend / Health | [Picture](1440-frontend.png) | [Picture](390-frontend.png) | 5 / 5 |

**See:** The flat grey land stays flat grey. Progress sits beside each nameplate's title, with an empty or filled 3 px meter. Selected text and meters use the existing dark-on-yellow selection color; other meters use the existing off-white nameplate color. All five titles and meters fit on the phone in the planned and frontend stages. The primary subject is readable at every captured stage.

**Feel:** The count changes quietly with the recorded work. Selection remains the strongest accent, while the meter adds a compact completion cue.

**Think:** “This part landed” is distinct from “its tests were verified.” The Health tour text still says that Conduit's passing result is the agent's report. No success/failure color or health claim was added to the meter.

The temporary capture driver reused `journey/capture.mjs`, served the already built Website, and clicked its actual tour pips 4, 7 and 8. It waited 6, 9 and 13 seconds respectively, paused with the normal tour button, and captured the shared Forest renderer using Chromium/SwiftShader. It did not synthesize a scene or alter the saved data. [observations.json](observations.json) records the build base, saved dates, every story ID, expected and actual counts, colors, pixel bounds and assertions.

Assertions passed for all six captures: saved stage and five stable story IDs; each count and percentage fill; fill color equal to nameplate text color; accessible progress text with a decorative `aria-hidden` meter; no overlapping visible nameplates; the primary subject's whole nameplate inside the globe; no saved surveyed land and no capability territory labels. Planned additionally asserts all five whole nameplates fit inside the globe and none are hidden by crowding. Empty fills measure 0 px; full fills measure 58 px. Progress text is 9.92 px. Whole nameplates retain their original title height: 33.4 px, or 48.5 px for Read and publish articles. No browser page errors occurred.

The first stacked layout failed phone review: it hid one nameplate and clipped Manage's progress, leaving only three fully visible meters in planned/frontend. Putting progress beside the original-width title restored all five complete nameplates; the observations retain that red result under `redLayout`. The final [phone Roads picture](390-planned.png) preserves all five readable names from the [historical picture](../journey/390-5-roads.png).

Independent screenshot review applied **Legible at the resting view** (`principle_1e3418812c33`): containment alone is insufficient; the names and their distinguishing progress signal must be readable before zooming or panning. That review caught the stacked layout's clipping despite its DOM visibility measurements, then confirmed all five complete planned/frontend labels at both sizes in the compact layout, with no overlaps.

The intermediate part1 camera is intentionally focused more closely. As in the [historical phone Contracts picture](../journey/390-6-contracts.png), Manage is off-screen and the bottom of Read and publish articles is clipped; Discover and Discuss remain complete. Connect's title and meter also fit, although its outer background extends 1.3 px beyond the right edge. Thus the strict whole-box count is two, while three progress meters are fully bounded. Desktop part1 puts Manage off-screen. The observations distinguish CSS visibility and full-page bounds from actual containment in the clipped globe.

No private WebGL mesh inspection was used. The saved scenes' missing surveys and absent DOM territory labels support the stated boundary; this capture does not independently enumerate file-circle meshes or verify Conduit's reported tests. The independent visual observations above complement the browser measurements.

To repeat the pictured tour using the existing driver without overwriting historical pictures:

```sh
pnpm --filter @storytree/website build
cp packages/website/evidence/journey/capture.mjs packages/website/evidence/unsurveyed-islands/.capture-temporary.mjs
node packages/website/evidence/unsurveyed-islands/.capture-temporary.mjs --only roads
node packages/website/evidence/unsurveyed-islands/.capture-temporary.mjs --only contracts
node packages/website/evidence/unsurveyed-islands/.capture-temporary.mjs --only conduitHealth
rm packages/website/evidence/unsurveyed-islands/.capture-temporary.mjs
```

The unmodified driver uses its original image names and captures while the tour plays. This run's temporary adaptation added the assertions above, paused before capture, and named the pictures by saved stage. It has been deleted. Browser and local server were closed after capture.

## Regression checks

The new 3.29 test first failed on the missing progress result, then passed for planned, claimed, partly landed and fully landed scenes across reported passing, failing and not checked. Surveyed islands keep their existing presentation and placeholder capabilities contribute no progress. All 169 Forest tests passed, including verified health colours and failure attention.

The existing real-browser journeys passed: opening; tour/Conduit growth; camera; Forest loading and fallbacks; controls at 1440/390/320; immersive layout; recording speed/holds and depth. After the compact layout change, tour, camera, Forest, controls, immersive and recording were rerun against its build. The final deferred-opening journey also passed, covering handover, replay, scroll, returning visitors, missing IntersectionObserver and delayed import cancellation. It recorded zero scene activations, mounts and globe draws before handover, 57.29 fps at startup and 60.00 fps during the swarm; finale at 22.00 seconds. These are local Chromium/SwiftShader observations, not hardware performance guarantees.

Raw regression summaries: [opening](opening-frames.json), [tour](tour-observations.json), [Forest](forest-observations.json), [immersive](immersive-measurements.json). Their original `.pgtest` capture paths describe local runs; the six pictures above are the committed visual evidence. Build commit fields identify the base commit plus this working-tree change.

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs regression-local --verify-opening --verify-tour --verify-camera --verify-forest --verify-controls
node packages/website/evidence/capture.mjs regression-opening-local --verify-opening-frames
node packages/website/evidence/capture.mjs regression-immersive-local --verify-immersive
node packages/website/evidence/capture.mjs regression-recording-local --verify-recording
pnpm gate
```
