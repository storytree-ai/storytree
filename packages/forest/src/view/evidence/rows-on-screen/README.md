# Rows on screen: storytree's own globe

Two sets of evidence share this folder: the investigation of 2026-10-10 into why the rows do not read and how far the globe turns, and the first fix it led to, the level opening (forest 3.11), with its before and after.

## The investigation: do the rows read as rows on screen, and how far can the globe turn?

An investigation, not a landing: nothing in the product changed. The owner, 2026-10-10: "storytree desktop still
doesnt show a dag south to north layout (also still feels like i can spin the globe to many directions making it
such that i cause myself to lose focus and disorient myself)". These are the measurements and pictures behind
the two questions and the increments on the arc "A north-up planet" (arc_ec14d94e5093).

Storytree's own project on 2026-10-10: 21 stories in 9 rows, globe radius 250.4 ground units. Read from the live
library (read only) with this checkout's code survey by `measure.mts`; pictures are the real desktop page on that
seed, 1440 x 960, headless Chromium with SwiftShader, through the shared capture kit.

Everything in this section was measured before the level opening landed (the section after this one): `opening.png`
and `measurements.json`'s first view are the tilted opening that change removed, and `front.png` is close to what
the app opens on now. Its scripts and files are `measure.mts`, `experiments.mts`, `capture-investigation.mjs`,
`measurements.json`, `experiments.json` and the pictures named below; the level opening's are `seed.mts`,
`survey.mjs`, `build.mjs`, `capture.mjs`, `measurements-before.json`, `measurements-after.json` and its two pictures.

### What the app opens on

| | |
| --- | --- |
| [opening.png](opening.png) | The view the app opens on: spun 2.5° and tilted 18° toward the islands' middle (ADR-0855 D3) |
| [front.png](front.png) | The same globe with no spin and no tilt |
| [opening-dependencies.svg](opening-dependencies.svg) | A schematic of the opening view: every dependency the rows are built from, green where the dependent is north of what it depends on, on screen; red where it is south; dashed grey where an end is behind the globe |
| [opening-pathways.svg](opening-pathways.svg) | The same for the pathways the globe draws |

At the opening view (`measurements.json`, `views[0]`; the page itself agrees, `opening.json`):

- **10 of 21 islands are readable** (facing the eye at 0.5 or more, so drawn at half their width or more), 7 are
  squeezed at the rim, and 4 are behind the globe: Identity, The local database, The arc surface and The app.
  The squeezed ones include the largest island (The agent link, 229 units wide, facing the eye at 0.18) and most of
  the top of the chain: The forest, The website, The command line, The app setup.
- Of the **60 dependencies the rows are built from** (the code's package edges, ADR-0840 D2): 41 have the dependent
  north of what it depends on, on screen; 1 points south (The agent link, row 4, drawn below Guardrails, row 3);
  18 have an end behind the globe. Only **11 of the 60 are seen pointing north with both ends readable**.
- Of the **19 story-to-story pathways drawn** (the plan's capability dependencies): 14 north, 1 south, 4 with an
  end behind the globe; 5 with both ends readable. The other 41 dependencies that decide where an island sits are
  not drawn: The website is in row 7 because of five code dependencies, and no pathway leaves it.

By latitude the rule holds: every island is north of everything it depends on (60 of 60). What fails is the
reading on screen. Three causes, each measured:

1. **A row is thinner than its islands.** Nine rows share 92° of latitude, so a row is 50 ground units tall;
   the islands are 40 to 229 units wide (median 79), and 20 of the 21 are wider than a row is tall. Islands cannot
   sit in their rows above what they depend on, so growth pushes them sideways along their rows (ADR-0839 D3,
   ADR-0850 D1): 10 of 21 sit more than 20° of arc from their row place, The arc surface 67°, The app 58°, The
   agent link 54° (the limit is 69°, MAX_NUDGE, raised from 17° by ADR-0910).
2. **So the rows wrap round the globe** instead of sitting on its front: the bottom row spans 241° of longitude,
   row 5 spans 193°, and row 7 (two islands, The website and The app) spans 148°.
3. **The opening tilt bends the rows.** Without a tilt every row is a level line on screen, whatever the spin
   (the eye is far away, so a parallel of latitude is drawn flat). At the opening tilt of 18°, rows 3 and 4, and
   4 and 5, overlap in height and one dependency points south; with no tilt, none does (`views[1]`, `views[2]`).

### What making the rows read would cost

`experiments.mts` runs the same layout code with one constant changed at a time (`experiments.json`, `layouts`),
each read at a level opening (spun to the islands' middle, no tilt):

| Layout | Globe radius | Islands drawn at | Readable | Behind | Dependencies seen pointing north |
| --- | --- | --- | --- | --- | --- |
| Today | 250 | 100% | 11 of 21 | 5 | 21 of 60 |
| Islands pushed at most 34° from their row place, the globe grows instead ([variant-pushed-34.png](variant-pushed-34.png)) | 305 | 82% of today's width | 14 | 1 | 37 of 60 |
| Islands pushed at most 17°, as before ADR-0910 ([variant-pushed-17.png](variant-pushed-17.png)) | 463 | 54% | 19 | 0 | 55 of 60 |
| Rows from 60° south to 60° north | 231 | 108% | 9 | 4 | 14 of 60 |
| Sea between islands as before ADR-0910 (12, not 36) | 218 | 115% | 12 | 3 | 24 of 60 |
| Rows ranked by the plan's dependencies (4 rows) | 255 | 98% | 10 | 5 | 12 of 19 |

The camera frames the whole globe, so a bigger globe draws every island smaller: rows that read and land this big
pull against each other (ADR-0910 asked for bigger land; ADR-0839 for rows).

### How far the globe turns

`packages/forest/src/view/planet-navigation.ts` and `packages/forest-world/src/planet/PlanetWorldCanvas.tsx`:

- **Spin** has no limit: a drag as long as the canvas is tall turns the globe once round.
- **Tilt** stops 2° short of each pole (88°).
- **Zoom** (the wheel) runs from 0.1 to 30 CSS pixels a ground unit. The page opens at 1.46, so the wheel shrinks
  the globe to 7% of its opening size, a 50-pixel dot, and grows it 20 times; past about 4 times the islands drop
  away by design (ADR-0919 D3). There is no pan: the zoom is about the middle of the canvas.
- **Nothing brings the view back**: no home control, no snap. The only marks at the rim are for failing islands
  (never-hidden), and nothing is failing.

| | |
| --- | --- |
| [spun-half-round.png](spun-half-round.png) | A sideways drag of half the canvas's height: 1 island readable, 5 at the rim, 15 behind the globe |
| [tilted-to-the-limit.png](tilted-to-the-limit.png) | Tilted down to the limit: 3 readable; the rows are rings round the pole, and The forest (row 6) is drawn above The command line (row 8) |
| [zoomed-out-to-the-limit.png](zoomed-out-to-the-limit.png) | The wheel out as far as it goes |

The fewest islands each limit would leave readable, over every turn it allows (`experiments.json`, `turning`);
storytree's islands lie between 117° west and 133° east, 51° south and 51° north:

| Limit | Fewest readable | Fewest facing the eye |
| --- | --- | --- |
| Today: any spin, tilt to 88° | 0 | 2 |
| The point facing the eye stays among the islands | 1 | 4 |
| The same with 25° of margin | 1 | 4 |
| Spin among the islands, tilt at most 20° | 2 | 6 |
| Spin among the islands, no tilt | 3 | 7 |

While the rows wrap round the globe, no turning limit keeps many islands in view: the limit and the layout are
one problem.

### Rerun

```sh
node --import tsx measure.mts            # reads the live library (read only); writes investigation-seed.json.gz, investigation-survey.json, measurements.json, the schematics
node --import tsx experiments.mts        # experiments.json, from that seed
node --import tsx capture-investigation.mjs build
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture-investigation.mjs --retake
```

The investigation's own seed and survey (`investigation-seed.json.gz`, `investigation-survey.json`) are not committed
(4 MB; `measure.mts` takes fresh ones, and never touches the level opening's `seed.json.gz` and `survey.json`). A
rerun measures the code as it stands, so its opening view is the level one; the committed numbers are the record
from before it. The two variant pictures were taken with `MAX_NUDGE` in
`packages/forest/src/planet-places/island-growth.ts` set to 0.6 and 0.3 for the build only
(`capture-investigation.mjs build --variant <name>`, then `capture-investigation.mjs --retake --variant <name>`),
and the source put back.

## The level opening: rows on screen, before and after (forest 3.11)

Branch `claude/increment-daf5ffe39871-e3a13b`. The app used to open turned toward the islands' middle, or the
first failing island, in both spin and tilt (ADR-0855 D3). The globe is drawn from far away, so with no tilt
every row of islands (a band of latitude) is a level line on screen, and any tilt bends each row into an arc.
Now `openingTurn` (`packages/forest/src/never-hidden/never-hidden.ts`) keeps the spin and never tilts. These are
pictures for the owner to look at; nothing here is recorded as accepted (ADR-0794).

| View | Before | After |
| --- | --- | --- |
| As the app opens storytree's own globe | [before-opening.png](before-opening.png) | [after-opening.png](after-opening.png) |

Measured on the opening view (`measurements-*.json`), over the islands facing the eye, with each story's row
ranked as the app ranks it (the survey's package dependencies, ADR-0840 D2):

- **Tilt** (how far north leans toward the eye): before 22.8°, after 0°.
- **Rows overlapping in height** (`rowBandsOverlapping`: a lower row's highest island drawn above a higher
  row's lowest): before rows 3/4, 3/5 and 4/5; after none. All nine rows now stack bottom to top.
- **Dependencies in view pointing up the screen**: before 42 of 43 (The agent link, row 4, drawn below
  Guardrails, row 3); after 40 of 40 (fewer are in view, the eye no longer looking down on the southern rows).

Renderer: headless Chromium 148, 1440 x 960, dark theme, device scale 1. Both builds get the same stand-in
bridge, seed, survey and viewport; nothing is hand-panned.

- **Seed** (`seed.json.gz`): a read-only snapshot of the real library (project `storytree`, 21 stories),
  taken by `seed.mts` on 2026-10-10.
- **Survey** (`survey.json`): `readCodeSurvey` over this checkout with the seed's tree, by `survey.mjs`.
- **Before** is `origin/main` at `0e5ef98b`; **after** is this branch.

### Rerun

```sh
tsx seed.mts                       # optional: a fresh snapshot (reads the library, writes nothing to it)
tsx survey.mjs
node --import tsx build.mjs <a checkout of origin/main> before
node --import tsx build.mjs <this checkout> after
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs after
```

Append `--retake` to a capture command to replace these committed pictures; without it the output goes below
`/tmp/storytree-captures`.
