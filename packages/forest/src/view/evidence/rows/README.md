# Islands in rows by dependency depth: before and after

Branch `claude/increment-aaaaffc8771d-82acf3`. Islands used to sit at fixed spots handed out in the order
their stories were created (a spiral of 36 spots from the globe's front). Now
(`packages/forest/src/story-nodes/story-nodes.ts`, `packages/forest/src/planet-places/`) each story is in a
row one above the deepest story it depends on (capability dependencies rolled up to stories); the rows are
bands of latitude from about 42° south to 42° north, evenly spaced; the bottom row has the story most
depended on in the middle and the rest outward, a higher row is ordered by where its dependencies sit, and
each row is packed round the front of the globe with the sea gap between neighbours. No row lines or labels
are drawn. These are pictures for the owner to look at; nothing here is recorded as accepted (ADR-0794).

| View | Before | After |
| --- | --- | --- |
| The globe unturned, its front facing the eye (the page's eye, spin and tilt zero) | [before-front.png](before-front.png) | [after-front.png](after-front.png) |
| The same, zoomed out (x0.7) | [before-wide.png](before-wide.png) | [after-wide.png](after-wide.png) |
| As the app opens it (turned toward a failing island) | [before-opening.png](before-opening.png) | [after-opening.png](after-opening.png) |

Every dependency between two stories, and whether the dependent's island sits north of its dependency's
(`measurements-*.json`, `edges`): **before 5 of 14, after 14 of 14**. The after's rows, measured on the
unturned globe: the six stories that depend on nothing at 41–46° S; The dev loop, The agent link and The
knowledge core at 10–14° S; The app, The forest, The arc surface and The command line at 14–17° N; The app
setup at 42° N. Islands sit a few degrees off their row's latitude where a big neighbour in the next row
nudged them (The world is the largest island, and its row is 28° from the next).

The opening view is still turned, and can roll, toward the failing island; keeping north up is the arc's
other increment, not this one.

Renderer: headless Chromium 148, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1. Both builds
get the same stand-in bridge, seed, survey, viewport and turns; nothing is hand-panned.

- **Seed** (`seed.json.gz`): a read-only snapshot of the real library (project `storytree`, 14 stories),
  taken by `seed.mts` on 2026-10-01; the history keeps each record's `created` change and its last later one.
- **Survey** (`survey.json`): `readCodeSurvey` over this checkout with the seed's tree, by `survey.mjs`.
- **Before** is `origin/main` at `63e85af2`, built from a throwaway worktree; **after** is this branch.

## Rerun

```sh
tsx seed.mts                       # optional: a fresh snapshot (reads the library, writes nothing to it)
tsx survey.mjs
git -C <repo> worktree add --detach /tmp/rows-before origin/main && (cd /tmp/rows-before && pnpm install)
node --import tsx build.mjs /tmp/rows-before before
node --import tsx build.mjs <this checkout> after
flock /tmp/storytree-heavy.lock node --import tsx capture.mjs before
flock /tmp/storytree-heavy.lock node --import tsx capture.mjs after
```

The scripts now provide seeds and views to the shared desktop capture runner.
Browser launch, bridge installation, the asset server, settling, output and cleanup
live in `apps/desktop/src/capture`. The default output is the matching folder below
`/tmp/storytree-captures`; append `--retake` to the capture command to replace these
committed pictures deliberately. Use `CAPTURE_CHROMIUM` or `CAPTURE_PLAYWRIGHT` for
an explicit browser override; no machine-specific home path is needed.
