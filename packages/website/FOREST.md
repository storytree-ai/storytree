# The saved forest

From the checkout root, refresh the public drawing snapshot with:

```sh
node --import tsx packages/website/src/refresh-forest.ts
```

The command calls the forest story's `refreshForestFromLibrary`
(`@storytree/forest/snapshot`), which reads the `storytree` library and draws it
with the forest's own `forestScene`, `storyNodes` and `growPlanet`; the website
depends on no other story for it. It writes `src/forest-snapshot.json` only after all
reads and drawing preparation succeed. A failed refresh keeps the old file.

The committed file contains the capture time, story names and islands, capability
forms derived from agent-reported health and work state, dependency links, and
globe positions, in rows by dependency depth as the app lays them out. It contains no raw records, descriptions, activity
lines, session identities, credentials or source paths. Library, history and
activity are read separately; this is a saved drawing, not an atomic database
backup. Retired stories retain their places through the creation history.

`forest-data.ts` is a type-only description a browser can consume without importing
the refresh command or any database code. The snapshot test exercises the export
with private fields present in its input and verifies preservation on failure.

The browser entry waits for the text page to paint and for the map to enter the
viewport before importing React, the committed JSON and the public
`@storytree/forest-world/planet` canvas. The still stays visible until a frame has
drawn. Missing WebGL, download or initialization failures, a 15-second startup
timeout, and context loss leave the still in place. No JavaScript is needed for
the still, installation command or contact links. The map renders on demand;
keyboard and touch buttons turn it while scrolling over the drawing continues
to scroll the page.

Refresh the two stills whenever the JSON or shared renderer changes. From the
checkout root, after refreshing the snapshot above:

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/forest/build-observed.mjs
node packages/website/evidence/forest/capture.mjs --stills
pnpm --filter @storytree/website build
node packages/website/evidence/forest/verify.mjs
node packages/website/evidence/forest/build-observed.mjs
node packages/website/evidence/forest/capture.mjs
```

This needs Playwright's Chromium installed. The evidence harness runs an isolated
desktop drawing; it does not access the running app or a database. Commit the
snapshot, `public/forest-*.png` and renewed evidence together. The square stills
are central crops of the actual rendered canvas, preserving its short-side
framing at other viewport sizes. They are not separately drawn illustrations.

The saved scene uses the shared renderer's base islands and pathways; it does not
include a source-code survey or the desktop's territory colouring and file-circle
overlays, and the public canvas does not add the desktop's story-name labels.
The picture shows geography and connections, not a readable health report.
Do not present the saved health as independently verified health.
The desktop comparison adapts its layout and opening rotation to the saved
inputs, while leaving its drawing code intact. Reproduction instructions,
measurements, screenshots and the precise comparison limits are in
[the forest evidence](evidence/forest/README.md).
