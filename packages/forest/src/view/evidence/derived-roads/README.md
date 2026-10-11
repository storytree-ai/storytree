# Roads and rows from the code's derived edges; no rings, no coast-to-coast lanes

Increment `increment_31ab24383a6d` (ADR-0991 D2, D3, D5): forest 3.6, 3.26 and 1.9, world 6.8; forest 3.27 retired.
These are pictures for the owner to look at. Nothing here is recorded as accepted (ADR-0794).

Before, the roads were the plan's recorded capability dependsOn, and rows were ranked by each story package's
package.json dependencies. Selecting a story lit a plain lane from coast to coast for each package dependency no road
joined, and ringed each neighbour. Now the roads are the code survey's derived capability edges together with the
recorded dependsOn. A story's row is ranked by its code's edges plus its recorded roll-up, so package.json fields rank
nothing. A selection lights roads only, with no rings.

| View | Before (main) | After (this branch) |
| --- | --- | --- |
| The globe unturned, its front facing the eye | [before-front.png](before-front.png) | [after-front.png](after-front.png) |
| As the app opens it | [before-opening.png](before-opening.png) | [after-opening.png](after-opening.png) |
| The website selected, turned to face the eye | [before-website-selected.png](before-website-selected.png) | [after-website-selected.png](after-website-selected.png) |

- **Roads between stories: 54 before, 330 after**, 116 of them type-only (`*-front.json`, `rows.json`). Type-only
  roads do not yet look different from the others; telling them apart is the next increment on the arc.
- **The survey derives 316 edges, 127 of them type-only, and none has a file without a capability at either end**,
  so every story edge has a road under it and none is left without one.
- **The website selected:** before, 7 straight lanes from coast to coast, one per package.json dependency (The arc
  surface, CI health, The forest, The knowledge core, The mark, The world, The app setup), and 7 rings. After,
  27 lit roads to The forest (7), The library (4), CI health, Session management, The arc surface and The world
  (3 each), The mark and The knowledge core (2 each), and no ring (`*-website-selected.json`). The app setup drops
  out: no source file of the website imports it.
- **Rows: one island changed row.** The website moves from row 6 to row 5, beside The app setup, since only its
  package.json named The app setup. The other 22 stories keep their rows (`rows.json`'s `moved`). Within rows the
  order changes a lot, though: a row is ordered by where the stories it depends on sit, and the derived edges
  add many of those, so most islands move east or west round the globe.

Renderer: headless Chromium, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds get the same
stand-in bridge, seed, survey, viewport and turns.

- **Seed** (`seed.json.gz`): a read-only snapshot of the real library (project `storytree`, 23 stories, 126
  capabilities), taken by `seed.mts` on 2026-10-11. It keeps only the stories' changes, which give the creation
  order that breaks ties in a row.
- **Survey** (`survey.json`): `readCodeSurvey` over this branch with the seed's tree, by `survey.mjs`. It carries
  both `edges` (read after) and the package.json `dependsOn` (read before).
- **Before** is `main` at 5e48d5dc; **after** is this branch.

## Rerun

From this folder: `tsx seed.mts`, `tsx survey.mjs`, `node --import tsx build.mjs <main checkout> before`,
`node --import tsx build.mjs <this checkout> after`, then
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after --retake`, and
`tsx rows.mts <main checkout> <this checkout>` for `rows.json`.
