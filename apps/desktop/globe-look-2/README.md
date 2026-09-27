# Throwaway globe look 2

Spike only; never merge or open a pull request. Product source is unchanged. The build substitutes
three small experiments while bundling the actual desktop renderer, HTML, styles, labels and controls.
Independent source diffs are saved under `docs/research/globe-look-2/changes/` for review and line counts.
The baseline has none of these substitutions. The only capture addition is read access to the mounted
R3F scene. Browser screenshots are full 1440 × 960 pages with dark theme, without retouching.

This follows `apps/desktop/src/forest/evidence/README.md` and borrows the browser launch and capture
path from `spike/planet-look:apps/desktop/planet-look/`. It replaces Electron's bridge with reads
captured through the actual `pageReads` API of a freshly seeded isolated database. No 0.2 files or
owner planning records are changed. The seven real stories retain their seeded health and empty
activity log. The 36-story input is a separately named synthetic project using repeated capability
counts, with every fourth story planned and the rest landed/passing. Diagnostic failures are also
browser-only copies, never writes to the seeded library.

```sh
flock /tmp/storytree-heavy.lock env STORYTREE_HOME=/tmp/globe-look-2-home pnpm seed:library
STORYTREE_HOME=/tmp/globe-look-2-home node --import tsx apps/desktop/globe-look-2/export.mjs
node apps/desktop/globe-look-2/build.mjs
flock /tmp/storytree-heavy.lock node apps/desktop/globe-look-2/capture.mjs
```

`PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` can override the existing Mint browser paths. All generated
bundles and the database read snapshot stay in the ignored `dist/`. The build records independent
patch sizes without instrumentation. `middle.txt`, `fit.txt` and `sea.txt` are the experiment source.
The fit applies through twelve stories; larger projects retain the current whole-globe framing.
