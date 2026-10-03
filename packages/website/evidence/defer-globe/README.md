# Chapter 2 waits for Chapter 1

2026-10-03, Mint box, increment_a15b78ec3a7e, contract 2.3.

The globe now waits for the opening handover or a scroll past Chapter 1. Run does not request or mount it. Replaying Chapter 1 unmounts it and invalidates pending activation/import completion. The still remains available until the globe is ready.

## Measured page time

The same harness served local builds at 1440×900 with Chromium/SwiftShader. Before is unchanged main `5f910f950b3ae7e3d5d8b30af99cfebbea34cc55` (PR #566); after is this branch's working tree built from that base. Existing observation JSON commit fields identify that build base, not a separately committed after build. No chapter was hidden and no virtual clock was used in the frame measurement. Frame rates are page requestAnimationFrame intervals, not an independently sampled display capture.

| Observation | Before | After |
| --- | ---: | ---: |
| Ready/startup mean fps | 11.54 | 57.29 |
| Ready/startup p95 frame interval | 650 ms | 16.8 ms |
| Swarm mean fps | 60.00 | 60.00 |
| Run to finale | 22,002.8 ms | 22,002.3 ms |
| Scene activations before handover | 1 | 0 |
| Mounted globe layers before handover | 1 | 0 |
| Globe WebGL draw calls before handover | 2,798 | 0 |
| Scene requested before handover | yes | no |

The startup sample runs from the first page animation frame until Run (about 2.6 seconds). The playing sample ends when the harness observes the finale; its callback intervals and the DOM observer's Run-to-finale measurement are separate readings. Raw values are in `before/opening-frames.json` and `after/opening-frames.json`.

This reproduces unnecessary startup rendering and its cost, **not** the earlier friction report's sustained 2–6 fps swarm. Current main's swarm already settles at 60 fps in this environment. These are individual local runs, not a universal performance guarantee. The eager Run warm start is removed because the scene must stay unmounted until handover. The after build's cold handover took 1,420.6 ms from activation to the live callback; the existing still covers that wait.

## Product proof

The new `--verify-opening-frames` journey failed on main with activation count 1 instead of 0. It passes after the loader change: no request, mount or draw during Chapter 1; live handover; replay cleanup; scroll remount; returning visitor; no-IntersectionObserver fallback; and a delayed scene import arriving after Replay cannot remount the globe.

All directly relevant journeys passed:

- `--verify-opening --verify-tour --verify-camera --verify-forest --verify-controls`: Chapter 1's CRT, keyboard, exits, sound, denied storage, no script and reduced motion; Conduit growth, flights and exploration holds; phone tour, no-WebGL and failed scene stills; waitlist controls at 1440/390/320. CRT turn: line 449 ms, point 715 ms, handover 1,166 ms. The full opening journey observed the finale after 22,423 ms.
- `--verify-immersive`: chapter, globe, controls and drawers at 1440/390/320.
- `--verify-recording`: tour speed/holds and readable depth over the app drawers; dated free play.
- `pnpm gate`: Website scope, 41 Website tests and 11 boundary tests, typecheck and plan edges passed. Guidance is NOT RUN because no role or supporting guidance input changed; it is not counted as passed.
- `pnpm test-ratio`: read at the boundary; Website ratio 0.18, repository 0.93. This is a report, not a gate.

Reproduce from the repository root:

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs defer-globe/after --verify-opening-frames
node packages/website/evidence/capture.mjs defer-globe/journeys --verify-opening --verify-tour --verify-camera --verify-forest --verify-controls
node packages/website/evidence/capture.mjs defer-globe/immersive --verify-immersive
node packages/website/evidence/capture.mjs defer-globe/recording --verify-recording
pnpm gate
```

## Visitor evidence

Chapter 1: the visitor sees the same CRT and streamed jokes, with no competing globe startup; the terminal keeps their attention. At the turn, the still covers the cold load and the globe's existing flight introduces Chapter 2. Replay gives Chapter 1 the screen and renderer budget again. This changes lifecycle, not copy or visual design.

- [Desktop handover](after/handover-1440.png) and [phone handover](after/handover-390.png), after the first camera flight.
- [Desktop ready](journeys/1440-ready.png), [desktop peak](journeys/1440-peak.png), [phone peak](journeys/390-peak.png).

The browser tests exercise local builds and synthetic waitlist validation/transport. They do not attest a live external waitlist insertion or hardware GPU performance.
