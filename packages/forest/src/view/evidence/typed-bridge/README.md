# Forest captures use the shared bridge

The six remaining forest capture stand-ins now install the capture kit's
`fakeBridge`. Their seeded reads stay in `window.storytreeAnswers`; other reads
use the kit's typed defaults. Readiness also races the kit's unanswered-method
failure. The two performance probes record `defaulted` calls, and every migrated
capture asserts that its recorded errors are empty.

`verification.json` records runs against the unchanged desktop renderer from
main at `4eef7c6baa810580bc300712c63e8e9e58387d92`, on Mint with headless Chromium
and SwiftShader. Before the migration, the capability-name capture's new
empty-errors assertion failed with the reported `choice` error (`red.txt`).
Afterwards, all six captures passed that assertion. The shader probe ran for
two profile seconds and the redraw probe for five seconds; these runs check
bridge compatibility, not performance thresholds.

From the checkout root, build the shared rows renderer:

```sh
node --import tsx packages/forest/src/view/evidence/rows/build.mjs "$PWD" after
node --import tsx packages/forest/src/view/evidence/capability-names/capture.mjs after
node --import tsx packages/forest/src/view/evidence/nameplates/capture.mjs after
node --import tsx packages/forest/src/view/evidence/north-up/capture.mjs ../rows/dist/after after
node --import tsx packages/forest/src/view/evidence/one-program-per-frame/measure.mjs packages/forest/src/view/evidence/rows/dist/after after library 2
EVIDENCE=packages/forest/src/view/evidence node --import tsx packages/forest/src/view/evidence/redraw-only-changed/capture.mjs packages/forest/src/view/evidence/rows/dist/after after 5
```

For circles-fit, build the same renderer into its expected directory, then run
its capture. Its older standalone builder has an obsolete observation hook;
that repair is recorded on the capture arc's existing build-repair increment
(`increment_ee3e7d63d615`).

```sh
node --import tsx --input-type=module -e 'import path from "node:path"; import {buildCapture} from "./apps/desktop/src/capture/index.ts"; await buildCapture({root:process.cwd(),dist:path.resolve("packages/forest/src/view/evidence/circles-fit/dist/after")});'
node --import tsx packages/forest/src/view/evidence/circles-fit/capture.mjs after
```

The existing historical screenshots and measurements remain evidence of their
original runs. New runs write to scratch unless explicitly retaken. A sweep of
the package evidence scripts found no remaining unknown-call fallback that
returns `undefined`; explicit answers to optional reads are separate from that
fallback.
