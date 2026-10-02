# The site's saved forest

The website draws its committed reading with the public `PlanetWorldCanvas` after text has
painted and the map enters the viewport. Its still is a capture of that drawing.

| View | Production page | Forest detail | Desktop using the same saved scene |
| --- | --- | --- | --- |
| 1440 × 1000 | [production-1440.png](production-1440.png) | [forest-1440.png](forest-1440.png) | [desktop-app-1440.png](desktop-app-1440.png) |
| 390 × 844 | [production-390.png](production-390.png) | [forest-390.png](forest-390.png) | [desktop-app-390.png](desktop-app-390.png) |
| Missing WebGL, 390 px | [no-webgl-390.png](no-webgl-390.png) | [phone still](../../public/forest-phone.png) | |

## Reading and proof — 2026-10-02

The reading now includes surveyed territories, files and imports, plan descriptions and
health, selected knowledge changes, open arc records with complete questions, and a dated
recording under ADR-0852 D4. Refresh instructions and privacy policy are in [FOREST.md](../../FOREST.md).
The selected recording is 2026-10-02 00:00 inclusive to 04:15 exclusive UTC, with 287 lines.
It is a recording, not live activity. The initial page still draws base geography; later
increments mount the tour and its other surfaces.

[measurements.json](measurements.json) names the exact saved file by SHA-256 and records its
capture time, **2026-10-02 05:26:36 UTC**: **15 stories, 93 capabilities, 133 links**, radius
235.9702. Both widths agree exactly on all story-island transforms, all 83 shared base mesh
geometry/material readings, the dependency plan, and the camera. Turn changes the transforms
and Reset restores them. The desktop additionally draws territory colours, file circles
and story labels; those are absent from today's website canvas. This proves common base
geometry, not identical full UI or readable health. The desktop's dense phone labels overlap
in places; the website does not mount those labels in this increment.

`desktop-entry.tsx` runs the actual desktop `PlanetView` with an empty local knowledge core
and `library={false}`. Its existing evidence adapter supplies the saved scene/radius/spots,
sets opening rotation to identity, and inserts a scene observer in the shared canvas.
It sizes the desktop to the website's actual 1180 × 458 or 350 × 348 drawing area. All drawing
components remain real; no renderer is copied. The adapter was updated for the current
layout and opening-turn call sites. Observation output is ignored under `dist/`.
Production-page captures and timing runs use the unmodified production build.

The committed stills are central square crops of the actual opening canvas (458 and 348 px).
The live globe fits both frames, controls occupy their own strip, and phone text stays within
its viewport. An independent reviewer inspected both widths after the refresh and found no
new website clipping or overlap. The dense desktop labels remain a comparison limitation.

## Loading and fallback

Chromium 148.0.7778.96, headless ANGLE SwiftShader, device scale 1, reduced motion. Three fresh
contexts per viewport, cache disabled, local HTTP with 40 ms latency, 10 Mbit/s download and
1 Mbit/s upload; unthrottled host CPU and no server compression. These are local browser
measurements, not measurements of phone hardware. Medians from navigation start:

| Width | First text paint | Renderer requested | First rendered frame |
| --- | ---: | ---: | ---: |
| 1440 px | 136 ms | 390 ms | 3,620 ms |
| 390 px | 136 ms | 284 ms | 3,522 ms |

The scene chunk now includes the enlarged saved reading: 3,119,705 raw / 774,404 gzip /
597,440 Brotli bytes. It stays behind the dynamic import; the unit test keeps initial
JavaScript below 20 KiB. The measurements retain every resource and all six timings.

`verify.mjs` passed text-before-renderer ordering, offscreen lazy loading, no-script stills,
missing WebGL, failed chunk loading, initialization failure and context-loss recovery,
usable install/contact controls, phone layout and 200% text controls. The snapshot unit
proof covers retained data, complete question text, requested recording boundaries/project,
recursive private-field/path/cloud-id scrubbing and secret refusal before atomic replacement.

## Repeat from the checkout root

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/forest/build-observed.mjs
node packages/website/evidence/forest/capture.mjs --stills
pnpm --filter @storytree/website build
node packages/website/evidence/forest/verify.mjs
node packages/website/evidence/forest/build-observed.mjs
node packages/website/evidence/forest/capture.mjs
```

The scripts close every browser and local HTTP server they start. Rebuild after capturing
stills so the production output contains them.
