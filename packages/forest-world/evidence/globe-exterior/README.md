# Globe exterior, mounted (world 6.7)

`capture.mjs` mounts the planet canvas in real Chromium with two islands and their road, and switches its
exterior layer by layer: by default it draws the sea, each island's ground and the roads; each of those hides
alone, and an island's host marks stay; `surface=false` hides all of it. `exterior.test.ts` proves the
switches' rule without a GPU; this proves the canvas obeys it.

It also records what the proof executed (`../../survey-browser-coverage.json`), which is how the canvas and
its React parts (`PlanetWorldCanvas`, `PlanetGrowth`, `PlanetTrailRibbons`) are reached by a numbered test
without any Node test loading React, fiber, drei and three. A test process that loads that stack is the one
that deadlocks in Node's exit teardown (increment_67a3090c077c, increment_8b38cdfb7adb). After changing the
canvas, rerun the capture, then `pnpm survey:coverage forest-world`.

    node --import tsx packages/forest-world/evidence/globe-exterior/capture.mjs

`whole.png`: every layer. `no-grounds.png`: the grounds hidden, the road kept.
