# The globe grows (world 7)

2026-10-04, Mint box, increment_93effc6483e7, contracts 7.1–7.4 of The world.

The shared engine (`@storytree/forest-world/planet`) replays a recorded sequence of plan states as growth. `growthPlan(stages, { fromPoint, seconds })` turns the stages into windows. `<PlanetWorldCanvas growth={{ plan }}>` then draws them on its own clock, or at a fixed moment with `at`. The globe's glass swells from a point of light. Each stage's new islands rise out of the glass from their middles, with no overshoot. A road leaves the island it builds on once that island has settled. It draws on at the dependency lane's speed, and the island it reaches rises when it arrives (0.2's arrival, ported as behaviour). The whole plan is scaled by one factor to the length asked for. A stage that adds nothing takes no time.

This page grows both recordings over 15 seconds:

- **Conduit's recorded growth.** These are the 21 stages the tour already saves (`src/conduit-snapshot.json`). Five of them add something: the first five stories, their four links, CI's story, the backend's six stories with 36 links, and one more link.
- **storytree's own saved reading.** This is one plan state (`src/forest-snapshot.json`), grown by its dependencies alone: 15 islands, 133 links, 93 capabilities and 428 files. Its capabilities and files get fill-in windows, which the host's territories and file circles can read through `usePlanetGrowth()`.

## Pictures

Conduit, frame by frame (the capture's own `at` moments in seconds, with risen islands out of 12):

![Conduit's growth](conduit-strip.png)

storytree's saved reading, grown from one point:

![storytree's growth](storytree-strip.png)

Clips of each playing in real time: [conduit-growth.webm](conduit-growth.webm), [storytree-growth.webm](storytree-growth.webm). Single frames are `conduit-NN.png` and `storytree-NN.png`.

**Reduced motion** shows the end state at once and draws nothing more. `conduit-reduced-motion.png` and `storytree-reduced-motion.png` are byte-identical to each map's final frame (`-08.png`).

## Frame rate

`measurements.json` records each run. Frame rates are page `requestAnimationFrame` intervals at 1440×900 in headless Chromium on SwiftShader (CPU rendering), the same harness conditions as `../defer-globe/`. Each growth's 15-second play is measured beside a baseline: the same globe with no growth, redrawn every frame for as long, run back to back in the same capture. The clip is recorded on a separate run: recording video cost about 10 fps in an earlier run, where it was on the timed one. Other lanes share this machine (load average 7 to 10 on 12 cores during the final run), so the absolute numbers move with its load. The comparison that holds is growth against baseline within one run.

| Final run | Growth playing | Same globe, no growth |
| --- | ---: | ---: |
| Conduit, mean fps | 51.76 | 46.93 |
| Conduit, p95 frame | 23.5 ms | 26.7 ms |
| storytree, mean fps | 48.14 | 38.09 |
| storytree, p95 frame | 26.6 ms | 32.8 ms |

The growth draws no slower than the globe it grows into, because most of it draws less of that globe. The deferred-globe work measured 57.29 fps for its page's ready state (PR #567). That was a different page, on a quieter machine. The globe alone here, at 1440×900 under this load, is the ceiling the growth can reach, and the growth meets it.

## Reproduce

```sh
node packages/website/evidence/growth/capture.mjs
```

It asserts the following:
- no island is risen while the globe is still a point;
- islands only ever rise;
- every island has risen by the end, both at a fixed moment and after playing on the canvas's clock;
- under reduced motion every island shows at once;
- the browser reports no errors.
