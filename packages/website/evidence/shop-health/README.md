# The shop's saved growth, coloured by its own CI (increment_a0e1efc68913, ADR-0901, ADR-0902)

`src/refresh-shop.ts --ci <dir>` now reads the shop's archived push runs on `main` (the Mint box's
`~/storytree-lanes/shop-private/ci/`) and records each contract's verified health, dated when its run finished,
exactly as `storytree health ci` (packages/ci-health) judges a run: each test tied to its story by the title its
test file carries at the run's commit. Each saved stage is then coloured only by the runs finished by its time
(website 3.7). Pictures and the clip: `capture.mjs`, drawn by the shipped globe in Chromium.

| Picture | What it shows |
|---|---|
| `shop-pr2.png` | after PR 2: the code is not yet in story packages, so there is no land to colour |
| `shop-pr3.png` | after PR 3 (the move to story packages): its first CI run on `main` colours the parts healthy |
| `shop-pr7.png` | after PR 7: every part with code healthy by CI |
| `shop-complete.png` | complete: 63 contracts verified passing by the shop's CI |
| `shop-complete-before.png` | the same growth exported without `--ci`: every part untested (yellow) |
| `shop-health-strip.png`, `shop-health-growth.webm` | the strip, and the whole growth playing |

Parts per stage, from the saved file: healthy from PR 3 on (5 parts, rising to 13 at the end); a part reads
untested for the minutes between a contract being planned and the next run on `main` finishing (pr4-building,
pr6, pr8-building, pr11-building), which is what the record says. Two pieces of ground stay unclaimed: files no
numbered test reaches.

Found on the way: the shop's code is CommonJS, and the map's survey followed only `import`, so none of its files
fell in a part and land had nothing to colour (0 of 33 files). Fixed on its own pull request (#596, map 8.12):
30 of 33 now do.
