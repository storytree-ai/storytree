# Circles fit their territory: before and after

Branch `claude/increment-5caf95f9e20c-05e8ee`. Each code file's circle used to be placed with only its
middle on its capability's territory (so a circle could cross a border or the coast), could stack on
another when a territory had more files than spots, and had diameter 1.3 + 0.24 * sqrt(lines). Now
(`packages/forest/src/territories/territories.ts`, `fileCircles` / `landForCircles`;
`packages/forest/src/render/forest-scene.ts`) every circle lies wholly inside its own territory, none
overlap, they spread over their territory's room (each on the spot with the most room left, packed
from the middle only when spread they do not fit), the diameter is 1.2 + 0.14 * sqrt(lines), unscaled,
and an island whose circles would not fit grows its land. These are pictures for the owner to look at; nothing here is recorded as accepted
(ADR-0794).

| View | Before | After |
| --- | --- | --- |
| Resting front view of the whole globe | [before-front.png](before-front.png) | [after-front.png](after-front.png) |
| Close-up (zoom x2.6 of the resting zoom) facing The world | [before-world.png](before-world.png) | [after-world.png](after-world.png) |
| Close-up (zoom x2.6) facing The agent link, the island with the most files (91) | [before-crowded.png](before-crowded.png) | [after-crowded.png](after-crowded.png) |

Renderer: headless Chromium 148, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both
builds get the same stand-in bridge, seed, survey, viewport, turns and zoom; nothing is hand-panned.

- **Seed** (`seed.json.gz`): a read-only snapshot of the real library (project `storytree`, 14 stories,
  90 capabilities, including The world), taken by `seed.mts`. To keep it small, the change history
  keeps each record's `created` change and its last later change; story creation order, which places
  the islands, is unchanged.
- **Survey** (`survey.json`): `readCodeSurvey` over this branch's checkout with the seed's tree, by
  `survey.mjs`; 421 files. The same survey feeds both builds, so the files are the same.
- **Before** is `origin/main` at `2f1bd04c`, built from a throwaway worktree; **after** is this branch
  at `2e3ceec3` (circles spread over their territory's room).

## Rerun

```sh
tsx seed.mts                       # optional: a fresh snapshot (reads the library, writes nothing to it)
tsx survey.mjs
git -C <repo> worktree add --detach /tmp/circles-before origin/main && (cd /tmp/circles-before && pnpm install)
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node build.mjs /tmp/circles-before before
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node build.mjs <this checkout> after
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs after
```

Builds go to the ignored `dist/before/` and `dist/after/`. Each capture writes its three pictures and
its measurements; [measurements.json](measurements.json) holds both, per island.

## Measured, per island (before / after)

Read from the drawn meshes, in each island's own plate units. "Not wholly in own territory": the
circle's middle or any of 16 points on its rim lies outside the triangles of its own capability's
territory mesh. "Not wholly on land": the same points against the island's ground (the circle pokes
into the sea). Overlapping: pairs whose middles are closer than the sum of their radii. Ground: the
island ground mesh's area.

| Island | Files | Circles | Not wholly in own territory | Not wholly on land | Overlapping pairs | Min radius | Max radius | Ground area |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The library | 37 | 37 / 37 | 23 / 0 | 16 / 0 | 3 / 0 | 0.82 / 0.70 | 3.82 / 2.45 | 5904 / 5904 |
| The agent link | 91 | 91 / 91 | 46 / 0 | 24 / 0 | 6 / 0 | 0.82 / 0.70 | 3.49 / 2.26 | 8018 / 8018 |
| The app | 26 | 26 / 26 | 21 / 0 | 13 / 0 | 3 / 0 | 1.14 / 0.89 | 2.14 / 1.47 | 1735 / 1735 |
| The forest | 33 | 33 / 33 | 23 / 0 | 10 / 0 | 1 / 0 | 1.01 / 0.81 | 3.05 / 2.00 | 3300 / 3300 |
| The arc surface | 20 | 20 / 20 | 14 / 0 | 8 / 0 | 0 / 0 | 0.82 / 0.70 | 2.52 / 1.69 | 1259 / 1259 |
| The command line | 27 | 27 / 27 | 13 / 0 | 12 / 0 | 0 / 0 | 0.89 / 0.74 | 2.62 / 1.75 | 2347 / 2347 |
| The librarian | 17 | 17 / 17 | 12 / 0 | 8 / 0 | 3 / 0 | 0.77 / 0.67 | 2.00 / 1.39 | 835 / 835 |
| The knowledge core | 13 | 13 / 13 | 11 / 0 | 8 / 0 | 2 / 0 | 0.89 / 0.74 | 3.30 / 2.14 | 1647 / 1647 |
| The app setup | 22 | 22 / 22 | 16 / 0 | 11 / 0 | 3 / 0 | 0.86 / 0.72 | 2.43 / 1.64 | 1526 / 1526 |
| Process ledger | 19 | 19 / 19 | 13 / 0 | 9 / 0 | 1 / 0 | 0.86 / 0.72 | 2.30 / 1.56 | 1127 / 1127 |
| The website | 11 | 11 / 11 | 7 / 0 | 4 / 0 | 1 / 0 | 1.01 / 0.81 | 2.08 / 1.43 | 568 / 568 |
| The world | 79 | 79 / 79 | 31 / 0 | 16 / 0 | 5 / 0 | 0.94 / 0.77 | 7.84 / 4.80 | 22045 / 22045 |
| The local database | 4 | 4 / 4 | 2 / 0 | 2 / 0 | 0 / 0 | 0.97 / 0.79 | 2.80 / 1.86 | 528 / 673 |
| The dev loop | 22 | 22 / 22 | 12 / 0 | 7 / 0 | 0 / 0 | 1.17 / 0.91 | 3.00 / 1.97 | 2765 / 2765 |
| **All** | **421** | **421 / 421** | **244 / 0** | **148 / 0** | **28 / 0** | | | |

- Every surveyed file has a circle, before and after.
- Before, 244 of 421 circles crossed out of their own territory (3 of them with the middle already
  outside: one on The forest, two on The app setup) and 148 reached past the coast into the sea.
  After, none does either, and no two overlap.
- Radii are about two-thirds of before's; the largest is The world's `src/core/scene.ts` (3594 lines):
  7.84 before, 4.80 after.
- One island grew: The local database, ground 528 to 673 (+27%). Every other island's ground is
  unchanged.
- No page errors in either build; one `THREE.Clock` deprecation warning in both.

## What the pictures show

- **Before**: circles visibly cross territory borders and the coast. On The world
  ([before-world.png](before-world.png)) discs sit on the coastline at the top and on the left, and
  across the green/grey border; on The agent link ([before-crowded.png](before-crowded.png)) several
  discs straddle the coast on its right and bottom edges, and The library's and The app's do the same.
- **After**: no disc crosses a border or the coast in any of the three pictures. The circles spread
  over each territory as an even scatter, with clear space between neighbours, rather than bunching
  in its middle: on The world ([after-world.png](after-world.png)) they cover the large grey territory
  and the green ones edge to edge; on The agent link ([after-crowded.png](after-crowded.png)) each
  territory carries its own scatter. A few of The world's small green cells on its left show no
  circle at all. The circles are smaller than before's, so at the resting front view
  ([after-front.png](after-front.png)) they read as fine speckle on each island.
