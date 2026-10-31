# The saved forest

From the checkout root, refresh the public reading with an explicit recording window:

```sh
pnpm refresh:forest --from 2026-10-02T17:30:00.000Z --to 2026-10-02T21:45:00.000Z
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
fields, open arc views with only what the arcs drawer shows (an open question's
full text, a settled question's title and answer, never an increment's body), and
dated activity. The window is one whose sessions read notes whole, so a picked
session draws its reading path. The
recording window includes `from` and excludes `to`; every line retains its project.
Only session start/end/name, subagent start, note reads, claims/releases, landings,
closures, merges and close-outs are kept. Folder, machine, transcript, branch and
task fields are removed recursively. Home paths and the configured cloud project
id are redacted; recognisable credentials in retained text refuse the refresh.
No raw transcript or command event is exported. Library, history, activity and
code are read separately: this is a dated reading, not an atomic backup.

`forest-data.ts` carries browser-safe types. The refresh tests pin the retained
records, the arc fields the drawer shows, half-open recording boundaries, project identity,
recursive scrubbing and preservation of the previous file when a secret is found.

The browser entry waits for the text page to paint and for the map to enter the
viewport before importing React, the committed JSON and the public
`@storytree/forest/world/planet` canvas. The still stays visible until a frame has
drawn. Missing WebGL, download or initialization failures, a 15-second startup
timeout, and context loss leave the still in place. No JavaScript is needed for
the still. The map renders on demand and is turned by dragging it.

Refresh the two stills (`public/forest-*.png`) whenever the JSON or shared renderer changes. They are captured from the
website's own live drawing of the framed map, with the frame's buttons and notes hidden. From the checkout root, after
refreshing the snapshot above:

```sh
pnpm --filter @storytree/website build
node evidence/forest/forest-stills.mjs
```

This needs Playwright's Chromium installed. The capture serves the built site; it does not
access the running app or a database. Commit the snapshot, `public/forest-*.png` and renewed
evidence together. Each still is the rendered canvas's full width, cut to a band round
the sheet's names (1440 × 1000 at device scale 1, and 390 × 844 at scale 2). They are not
separately drawn illustrations. Do not present the saved health as independently verified health.

The still and loading behaviour (contracts 2.1 to 2.3: text and the closing call before the scene's
code, the live scene replacing the still, a saved picture of each view's own project when
WebGL is missing or the scene fails to load) is proven by the website's browser journey,
`node --import tsx testing/capture.mjs --verify-forest`, which writes its pictures to a
scratch folder (`forest --verify-forest --retake` writes them into the forest evidence). The 2026-10-02 harness that
compared the website's drawing with the desktop's on the same saved scene is retired; its
record and what replaced it are in [the forest evidence](evidence/forest/README.md).
