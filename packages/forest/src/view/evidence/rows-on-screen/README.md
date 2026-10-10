# The globe opens level: rows on screen, before and after

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

## Rerun

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
