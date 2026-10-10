# The saved forest

From the checkout root, refresh the public reading with an explicit recording window:

```sh
node --import tsx packages/website/src/refresh-forest.ts --from 2026-10-02T00:00:00.000Z --to 2026-10-02T04:15:00.000Z
```

The website owns the publication policy. It reads the marker's selected project
through the library and Session management's public exports, surveys the main checkout
through `@storytree/forest/code-survey`, and draws land with `forestScene`,
`storyNodes`, `growPlanet` and the arc surface's `workStates`. The Node-only
refresh resolves the forest's installed arc-surface dependency through its public
entry. `saveForestSnapshot` replaces the file only after every read and privacy
check succeeds; a failure keeps the old snapshot.

Under ADR-0852 D4, the committed reading now carries surveyed territories, files
and imports, story places, plan descriptions and health, selected knowledge-change
fields, open arc views with complete question text, and dated activity. The
recording window includes `from` and excludes `to`; every line retains its project.
Only session start/end/name, subagent start, note reads, claims/releases, landings,
closures, merges and close-outs are kept. Folder, machine, transcript, branch and
task fields are removed recursively. Home paths and the configured cloud project
id are redacted; recognisable credentials in retained text refuse the refresh.
No raw transcript or command event is exported. Library, history, activity and
code are read separately: this is a dated reading, not an atomic backup.

`forest-data.ts` carries browser-safe types. The refresh tests pin the retained
records, complete question text, half-open recording boundaries, project identity,
recursive scrubbing and preservation of the previous file when a secret is found.

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

The saved scene uses the shared renderer's base islands and pathways; the saved data includes a source-code survey for the later tour, but today's
canvas does not mount the desktop's territory colouring and file-circle overlays, and the public canvas does not add the desktop's story-name labels.
The picture shows geography and connections, not a readable health report.
Do not present the saved health as independently verified health.
The desktop comparison adapts its layout and opening rotation to the saved
inputs, while leaving its drawing code intact. Reproduction instructions,
measurements, screenshots and the precise comparison limits are in
[the forest evidence](evidence/forest/README.md).
