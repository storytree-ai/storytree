# The shop's honest WebGL fallback

2026-10-11, Mint box, increment_79ffbda05255, website contract 2.2.

Without WebGL (or when the scene's code fails to load), every view the globe would draw now shows a saved picture of that same
project, or says plainly why no picture can stand for it:

| View | What the visitor sees without WebGL |
| --- | --- |
| A tour step on the shop (the map and knowledge chapters) | A note above the narration, clear of the panels a step opens on the right and above the scrim behind the words: the map can't draw in this browser, this step replays a moment of the shop's recorded build that no single picture shows truthfully, the words play on, and free play shows the finished shop. Narration, timing, How and Why are unchanged. |
| Free play on the shop | The shop's own still (`public/shop-desktop.png`, `public/shop-phone.png`): the finished shop's eight islands and roads, drawn by the website's live renderer in free play and cropped square from its canvas by [`../forest/shop-stills.mjs`](../forest/shop-stills.mjs). Never storytree's still. |
| Free play on storytree | storytree's still, as before, now centred and larger on phones. |
| The arrival (storytree's growth) | Dark, as before (contract 2.11). |

| Width | Shop tour step | Shop free play | storytree free play |
| --- | --- | --- | --- |
| 1440×900 | [Picture](journeys/forest-no-webgl-1440-shop-step.png) | [Picture](journeys/forest-no-webgl-1440-shop.png) | [Picture](journeys/forest-no-webgl-1440-storytree.png) |
| 1280×800 | [Picture](journeys/forest-no-webgl-1280-shop-step.png) | [Picture](journeys/forest-no-webgl-1280-shop.png) | [Picture](journeys/forest-no-webgl-1280-storytree.png) |
| 390×844 | [Picture](journeys/forest-no-webgl-390-shop-step.png) | [Picture](journeys/forest-no-webgl-390-shop.png) | [Picture](journeys/forest-no-webgl-390-storytree.png) |
| 320×844 | [Picture](journeys/forest-no-webgl-320-shop-step.png) | [Picture](journeys/forest-no-webgl-320-shop.png) | [Picture](journeys/forest-no-webgl-320-storytree.png) |
| 1440, scene code fails | [Picture](journeys/forest-scene-fails-1440-shop-step.png) | [Picture](journeys/forest-scene-fails-1440-shop.png) | [Picture](journeys/forest-scene-fails-1440-storytree.png) |

**See:** a dark stage with the shop's finished map in free play; on a tour step, one dashed note at the top of the words' column
(the top of the screen on a phone), the step's words beneath it. On the arcs step the arcs panel covers the note, as it would
cover the globe.
**Feel:** nothing is broken or missing without saying so; the picture shown is always the project named in the bar.
**Think:** "my browser can't draw the live map, but this is what the shop looks like, and the tour told me why it isn't animated."

**2.2's proof, strengthened.** `../forest.mjs` used to accept storytree's still when it was loaded but hidden. It now reads what is
seen: each picture must be visible by computed style (`checkVisibility` with visibility and opacity) with area on screen, and its
on-screen pixels must show more than eight distinct colours; it checks the shop step, shop free play and storytree free play at
1440, 1280, 390 and 320, and again at 1440 when the scene's code fails. The read-only arcs panel and the waitlist stay usable (the
panels arrive with the scene's code, so they are checked only when that code loads).

Red: [`red/forest-observations.json`](red/forest-observations.json), on the branch base before any change: the shop step had no
note, the shop had no still, and storytree's still was never actually visible in the views checked. Green:
[`journeys/forest-observations.json`](journeys/forest-observations.json) (2.1, 2.2 ×5, 2.3 pass);
[`journeys/tour-observations.json`](journeys/tour-observations.json) (2.4–2.8 pass, including no-WebGL shop free play at 390,
[picture](journeys/390-no-webgl-shop-arcs.png)); [`review/fallback-review.json`](review/fallback-review.json) (the shop still
shown at all four widths); the arrival's `reduced` journey (2.11, storytree's still never under the pain) passes.

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/forest/shop-stills.mjs     # refresh the shop's stills when its snapshot or the renderer changes
pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs shop-fallback/journeys --verify-forest --verify-tour
node packages/website/evidence/capture.mjs shop-fallback/review --review-fallbacks
```

Chromium headless with SwiftShader on the Mint box; no hardware GPU.
