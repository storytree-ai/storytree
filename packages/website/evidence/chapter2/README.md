# Chapter 2: the saved globe, explained

Built from `03826903796f29387598d79a71bd574906568461` after refreshing main. The implementation ports the saved proposal's behaviour into the website and uses the app's public globe, story, session, arc and knowledge surfaces. The only app change accepts a recording clock in the sessions list; live hosts still use their wall clock.

The saved project and 287 recorded events remain unchanged. Playback compresses gaps to one event per second at 1× while preserving original timestamps. The plan and code stay at the saved capture. Copy explicitly identifies incomplete allocation, unavailable transcript totals and note bodies, and the absence of a ghost-inspection or maintenance-hotspot view.

## Pictures

| View | Desktop | 390 px |
| --- | --- | --- |
| Busy globe and opening problem | [1440](1440-busy.png) | [390](390-busy.png) |
| Capability territories | [1440](1440-capabilities.png) | [390](390-capabilities.png) |
| Read-only free play | [1440](1440-freeplay.png) | [390](390-freeplay.png) |

Also captured: [sourced comparison](390-comparison.png), [no WebGL](390-no-webgl.png), [reduced motion](390-reduced-motion.png), and [no script](390-no-script.png). Phone text, controls, contrast and stacking were inspected; the camera remains an interactive app drawing. A no-script visitor receives the static opening and contact path, while no-WebGL visitors retain the guided text and app reading panels.

## Observed red, then green

- Tour pacing, selection and holds: the new contract tests initially failed because the controller was absent, then passed with the implementation.
- Recorded playback: the adapter initially started with all 287 events instead of zero; its test then passed through actual app reading subscriptions, pause, speed and original event timestamps.
- Saved sessions: a browser set to 2030 initially lost the recorded active row. The optional app clock seam kept that same row available at the recording's own date.
- Guided camera: a browser interruption left Resume 88 pixels away from the intended destination, and Replay after dragging the first step left guidance disabled. Both checks passed after resuming the target and resetting each replay generation.

The final browser command exited zero:

```sh
WEBSITE_SHA=03826903796f29387598d79a71bd574906568461 flock /tmp/storytree-heavy.lock pnpm --filter @storytree/website build
flock /tmp/storytree-heavy.lock node packages/website/evidence/capture.mjs chapter2 --verify-tour --verify-opening --verify-enlarged
```

[Tour observations](tour-observations.json) cover contracts 2.4–2.6: line timing, speed, pause, Next under a hold, why focus and Escape, show everything, individual explainers and comparisons, Replay, skip, dated recording controls, story/capability/note/arc inspection, keyboard operation, waitlist hatch, real globe dragging, phone layout and no-WebGL operation. [Chapter 1 observations](opening-observations.json) cover its playback, joke, same-address turn, exits, optional sound, storage denial and static fallbacks. [Enlarged measurements](enlarged-measurements.json) cover 200% injected text at 320, 390 and 1280 px; this is not native browser zoom. [Measurements](measurements.json) include viewport widths, asset sizes and waitlist focus/target checks. No browser page errors were observed.

Comparison copy follows the durable research (`definition_b0b80acc7330`, linked from ADR-0857); its primary sources were rechecked on 2026-10-03. CodeScene receives credit for hotspots and change coupling. The settled owner answer remains settled, with no claim that Storytree ships those views or that a trial is part of this landing.

No allocation tests or allocation metadata were changed. Noticeboard, open pull requests and all worktrees were inspected before write batches; no overlapping website work was found.
