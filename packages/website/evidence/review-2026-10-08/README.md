# Website review — 8 October 2026

Increment `increment_98771c182078`, after PR #845 (`ea02dd40`). All pages were served locally; no waitlist entries or analytics events were sent.

The fixes align the sessions panel with the narration, recover the phone chapter markers, keep the saved date and read-only caption visible in free play, use one selection colour, and give phone depth/back/find/view controls 44px hit areas. Phone globe spacing also keeps the larger controls clear of the named islands.

The chapter sequence, spoken lines and timings are unchanged. Phone captions clipped at the edge or underneath the dated header are parked as `increment_105e46adad04`. The missing shop WebGL still is parked as `increment_79ffbda05255`; the current fallback check detects an image loading, so its pass does not prove the shop has a visible fallback.

## Before and after

Each pair uses the same viewport. The full chapter and depth captures are in `before/chapters/` and `after/chapters/`.

| Width | Sessions and narration | Chapter markers | Dated free play |
| --- | --- | --- | --- |
| 1440px | [before](before/agents-parallel-1440.png) · [after](after/agents-parallel-1440.png) | [before](before/tour-1440.png) · [after](after/tour-1440.png) | [before](before/immersive-1440.png) · [after](after/immersive-1440.png) |
| 1280px | [before](before/agents-parallel-1280.png) · [after](after/agents-parallel-1280.png) | [before](before/tour-1280.png) · [after](after/tour-1280.png) | [before](before/immersive-1280.png) · [after](after/immersive-1280.png) |
| 390px | [before](before/agents-parallel-390.png) · [after](after/agents-parallel-390.png) | [before](before/tour-390.png) · [after](after/tour-390.png) | [before](before/immersive-390.png) · [after](after/immersive-390.png) |
| 320px | [before](before/agents-parallel-320.png) · [after](after/agents-parallel-320.png) | [before](before/tour-320.png) · [after](after/tour-320.png) | [before](before/immersive-320.png) · [after](after/immersive-320.png) |

## Checks and reproduction

The existing recording journey was extended for contracts 1.6 and 2.6. Its baseline failure is in [red/recording.log](red/recording.log): five short controls and the hidden phone date. A temporary strengthening of 2.18 also found the clipped Cart caption ([red/caption.log](red/caption.log)); the proposed camera shifts created other tag collisions and were reverted. Caption framing is parked as `increment_105e46adad04`, and that temporary assertion is not presented as passing. Styling is reviewed through captures; no source-text or screenshot-pixel assertions were added.

From the repository root, build once, then run the existing capture recipe under the shared machine lock:

```sh
pnpm --filter @storytree/website build
node packages/dev-loop/src/heavy-lock.mjs -- node packages/website/evidence/capture.mjs review-2026-10-08/after --verify-immersive
node packages/dev-loop/src/heavy-lock.mjs -- node packages/website/evidence/capture.mjs review-2026-10-08/after/recording --verify-recording
node packages/dev-loop/src/heavy-lock.mjs -- node packages/website/evidence/capture.mjs review-2026-10-08/after/journeys --verify-tour --verify-camera --verify-forest
node packages/dev-loop/src/heavy-lock.mjs -- node packages/website/evidence/capture.mjs review-2026-10-08/after/chapters --review-chapters
node packages/dev-loop/src/heavy-lock.mjs -- node packages/website/evidence/capture.mjs review-2026-10-08/after/fallback --review-fallbacks
```

`--review-chapters` captures every chapter and its depth at 1440×900, 1280×800, 390×844 and 320×844, then free play; it records layout measurements and console errors. `WEBSITE_REVIEW_WIDTH` restricts that capture to one width. `WEBSITE_DIST` points the same recipe at a separately built baseline. `--verify-immersive` also checks 1920px and the short 320×700 and 320×568 phones.

The baseline opening, enlarged-text and forest/tour observations are retained in `before/opening/` and `before/journeys/`. Local after-captures identify an unpublished working tree, not a deployed commit.

## Final browser results

All five requested journeys passed: tour, camera, immersive layout, recording and forest. The chapter sweep checked 19 steps at each of the four requested widths (76 readings): no console errors, no narration overflow, no horizontal page overflow, and no narration/panel overlaps. Each step’s depth and the final free play were captured too. The 320×700 and 320×568 layout checks also passed.

The separate fallback review confirms that the shop still is invisible at all four widths; that known defect remains in the fallback increment above. The caption framing issue remains visible in the pictures and is not covered up by the passing journey results.
