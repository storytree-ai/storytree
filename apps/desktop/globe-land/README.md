# Globe land look test

Throwaway spike on `spike/globe-land`; never merge or open a pull request.
The capture path is borrowed from `spike/globe-look-2`, whose
`docs/research/globe-look-2/CAPTURE.md` describes the actual desktop-page capture.
Only this scratch harness and research evidence are committed; product source
and owner planning records are untouched.

Six pictures compare packed islands without sea (A), a connecting land skin (B),
and that same land skin after a quarter turn (C), for seven real seeded stories
and 36 explicitly synthetic stories. The real seed's health and activity are
preserved. The knowledge core is only a faint placeholder glow.

Generated bundles, the isolated seed database, and browser input live in ignored
`dist/`. Every seed, render and Playwright run holds `/tmp/storytree-heavy.lock`.
The completed measurement notes and reproduction steps accompany the pictures.

Reproduce a fresh instance of the look from this worktree:

```sh
flock /tmp/storytree-heavy.lock env STORYTREE_HOME="$PWD/apps/desktop/globe-land/dist/home" pnpm seed:library
STORYTREE_HOME="$PWD/apps/desktop/globe-land/dist/home" node --import tsx apps/desktop/globe-land/export.mjs
flock /tmp/storytree-heavy.lock node --import tsx apps/desktop/globe-land/measure.ts
node apps/desktop/globe-land/build.mjs
flock /tmp/storytree-heavy.lock node apps/desktop/globe-land/capture.mjs
```

A fresh database assigns new ids, which can change the seeded coast shapes. The
measurement step calibrates a *new throwaway table* against that seed and the
synthetic input; it must never be run to reposition a live project. The committed
`slots.json` is the exact table used by these pictures. Given the retained local
`dist/seed.json`, skip seed/export/measure to recapture these exact inputs.

`PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` can override the existing Mint browser
paths. Pass picture names to `capture.mjs` to capture only those cases, for example
`c-36-quarter-turn`. The full page screenshot deadline is 180 seconds for the
software renderer. `build.mjs` substitutes only the frozen globe placements,
removes the sea, adds the core placeholder and optional skin, and exposes the
existing scene and rotation setter for measurement. `land-skin.tsx` contains the
entire added drawing; L1 and the original island engine are untouched.

The [six-line picture index](../../../docs/research/globe-land/README.md) and
[capture notes](../../../docs/research/globe-land/CAPTURE.md) record the visual
limits, spacing, draw counts and checks. Every PNG has its own raw measurement
JSON beside it. This is a capture instrument, not product code or a test framework.
