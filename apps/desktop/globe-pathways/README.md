# Throwaway pathway capture instrument

This directory is a spike. No product `src/` file is changed, no package entrypoint
imports it, and this branch must never become a pull request.

Borrowed from `spike/globe-land`'s `apps/desktop/globe-land`, as described in
`docs/research/globe-land/CAPTURE.md`. The actual desktop HTML, CSS, renderer and
engine are bundled by esbuild. `build.mjs` contains every temporary substitution:

- observation of R3F state and the real page rotation setter;
- radius 218 instead of 160, retaining all 36 frozen directions;
- the existing ground wear atlas receives routed capability paths;
- a surface ribbon group for V1/V2, inside the actual rotating globe.

`prepare.ts` reads an isolated `pageReads` export, routes with the ported engine,
samples its cubic curves, and measures the clipped coasts. `paths.json` records
that geometry; `seed.json` retains the actual seed's tree and historical story
creations, without any supplementary dependency records. `declared-links.json`
records the 22 explicitly numbered story-file references used ONLY in V1/V2.
The fresh seed itself has zero cross-story dependencies; its 75 local links are
shown separately in the `within` arm. V1/V2 also carry a visible research badge.

Run from the repository root (dependencies already installed):

```sh
# A new seed produces new IDs and coast shapes; use the committed snapshot to
# reproduce these exact pictures. To deliberately measure a new seed:
flock /tmp/storytree-heavy.lock env STORYTREE_HOME="$PWD/apps/desktop/globe-pathways/dist/home" pnpm seed:library
env STORYTREE_HOME="$PWD/apps/desktop/globe-pathways/dist/home" node --import tsx apps/desktop/globe-pathways/export.mjs
flock /tmp/storytree-heavy.lock node --import tsx apps/desktop/globe-pathways/prepare.ts

# The committed paths.json and seed.json suffice for these two commands:
node apps/desktop/globe-pathways/build.mjs
flock /tmp/storytree-heavy.lock node apps/desktop/globe-pathways/capture.mjs
```

`PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` override the Mint box's installed paths.
The capture accepts picture names to rerun a subset, for example `v1-front`.
Servers, browser and isolated Postgres stop in `finally` blocks. Generated bundles,
full raw seed, cluster and logs live in ignored `dist/`.
