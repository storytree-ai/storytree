# The site's saved forest

The website now draws the committed snapshot with the public `PlanetWorldCanvas` after the
text has painted. Its still is a capture of that same drawing. These pictures are evidence for
review under ADR-0794, not an acceptance of the look.

| View | Production page | Forest detail | Actual desktop drawing of the same snapshot |
| --- | --- | --- | --- |
| 1440 × 1000 | [production-1440.png](production-1440.png) | [forest-1440.png](forest-1440.png) | [desktop-app-1440.png](desktop-app-1440.png) |
| 390 × 844 | [production-390.png](production-390.png) | [forest-390.png](forest-390.png) | [desktop-app-390.png](desktop-app-390.png) |
| Missing WebGL, 390 px | [no-webgl-390.png](no-webgl-390.png) | [committed phone still](../../public/forest-phone.png) | |

The public renderer draws flat translucent islands, coasts, the sea and cross-island paths.
The desktop adds its own story-name overlays; the website uses the engine's public drawing
without those private overlays. The snapshot has no source-code survey, so neither view in
this comparison has territory colours or file circles. The site makes no claim that health or capability state is legible in this base drawing,
and no claim of verified health. This compares scene geometry, not identical app UI.

## Same-scene proof

[measurements.json](measurements.json) identifies the snapshot by SHA-256 and records the
actual scene objects. The saved scene is from **2026-09-30 14:01 UTC**, with **14 stories,
90 capabilities and 131 dependency links**, globe radius 218.

Both widths have exact agreement between the site and desktop for:

- All 14 story-island world transforms, each with one ground mesh and one coast mesh.
- The position/index buffer hashes, world transforms and materials of all 81 shared meshes.
- All 131 dependency edges in the path plan, its 409 segments (383 local, 26 cross-island),
  and the camera position, quaternion, projection and zoom.
- Turn controls changing the island transforms, and Reset restoring the opening transforms
  and camera.

`desktop-entry.tsx` imports the **actual desktop `PlanetView`**, using an empty local knowledge
core and `library={false}`. It does not launch the app or connect to its database. The evidence
build makes precisely these adaptations in memory:

1. Supply the site's saved scene, radius and spots as `PlanetView`'s layout. This avoids
   inventing creation-history places absent from the public snapshot or recomputing positions.
2. Keep its opening globe rotation at identity, matching the website instead of invoking the
   app's automatic opening turn. All drawing components and story-name overlays remain real.
3. Insert an R3F observation child in the shared canvas that exposes scene/camera/renderer state.
   The same observation child is inserted in the website comparison build.
4. Size the isolated desktop canvas to the website's actual drawing area: 1180 × 458 or
   350 × 348. Copy the desktop's existing stylesheet into ignored build output for its labels.

No renderer code is copied into this package. The observation builds go to ignored `dist/`.
The production-page pictures and timing runs use the **unmodified production build**.

The committed PNG stills are central square captures of the actual opening canvas, at 458 px
and 348 px. The engine frames by the short side; `object-fit: contain` therefore preserves the
same globe size and position as the live drawing across responsive widths. The wide desktop
canvas contains only background beyond that square. They are 62,465 and 42,870 bytes.

## Load measurements

Chromium **148.0.7778.96**, headless, device scale 1, reduced-motion preference, ANGLE/Vulkan
SwiftShader software rendering. Each run uses a fresh browser context with cache disabled,
local HTTP, **40 ms latency / 10 Mbit/s download / 1 Mbit/s upload**, and an unthrottled host CPU.
The server does not compress responses. These are reproducible local comparisons, not field
performance or phone hardware measurements. The phone result is a 390 px browser viewport.

Each viewport has three runs. The script scrolls the forest into view after first contentful
paint (FCP) and records that action separately. FCP is the browser's paint measure for the
initial text page; `forest-request` precedes the dynamic import, and `forest-ready` follows
the first rendered R3F frame. Times below are medians from navigation start.

| Width | First contentful paint | Renderer requested | First rendered frame |
| --- | ---: | ---: | ---: |
| 1440 px | 120 ms | 174 ms | 1,868 ms |
| 390 px | 120 ms | 173 ms | 1,823 ms |

Initial JavaScript falls from **1,253,872 bytes** (the eager stub and page code before this
increment) to **2,643 bytes**: `forest.js` 1,205, `main.js` 800, shared helper 638. The new
`forest-scene` chunk is **1,281,569 raw / 365,927 gzip / 294,542 Brotli bytes** and is requested
only when the painted page brings the map into view. All JavaScript requested through first
render totals 1,284,212 bytes. Compression sizes are local estimates, not claimed network
transfers. The engine also emits optional HLS/vision chunks; neither is requested by this page.
The resource records contain actual encoded, decoded and transfer sizes for every request.

## Behavior and visual checks

The initial browser run [red.txt](red.txt) failed because the page had no saved still. The
final [verify.mjs](verify.mjs) passes the visitor behaviors in contracts 2.2 and 2.3:

- JavaScript disabled, WebGL missing, failed lazy-chunk request, renderer initialization
  throwing, and later context loss all preserve or restore the same saved scene.
- Missing WebGL is actually probed before asserting that no renderer request happened.
- With the renderer download held, the heading, install command and contact link remain usable.
- A map below the fold requests no renderer until it enters the viewport.
- At 320 px with doubled text, all three controls remain inside the map and at least 44 px;
  [controls-320-text200.png](controls-320-text200.png) records them. Scrolling over the canvas
  still scrolls the page. The website turns by buttons, not by capturing a drag on the map.
- Text paints before the renderer request; live canvases draw at desktop and 390 px without
  horizontal overflow. Copying the install command also works on the failure paths.

The resting-frame requirement (`principle_1e3418812c33`) is measured before judgment:
the globe diameter is the short drawing side divided by 1.18 — **388 px** on desktop
(84.7% of drawing height; 32.9% of width) and **295 px** on phone (84.7% of height;
84.3% of width). The smallest near-facing island by projected ground bounding-box area
is The local database: **34.7 × 26.2 px** desktop, **26.3 × 19.9 px** phone. These are
geometric extents, not a proof of readable names or health. Lower-rim islands overlap in
projection; turning reveals them. `pattern_efc36d671fa5`'s deterministic observation bar
is served by the fixed snapshot, identity rotation, matched camera and recorded geometry.

Visual review against the task's constraints: the globe fits inside both drawing areas;
controls have their own 52 px strip; coasts remain distinct from the sea; dependency paths
meet the drawn islands; the still occupies the same frame; and the phone page keeps its
text, install command and contact link readable. The opening globe deliberately uses the
same orientation in both comparisons, with most saved islands in its lower half. Its empty
upper half and the desktop-only labels are visible in the pictures for the owner's judgment.

## Repeat from the checkout root

```sh
node --import tsx packages/website/src/build.ts
node packages/website/evidence/forest/build-observed.mjs
node packages/website/evidence/forest/verify.mjs
node packages/website/evidence/forest/capture.mjs
```

To refresh the stills after changing the saved snapshot or framing, run the observation build,
then `node packages/website/evidence/forest/capture.mjs --stills`, and rebuild the website
before running the final verification and capture again. The scripts close every browser
and local HTTP server they start.
