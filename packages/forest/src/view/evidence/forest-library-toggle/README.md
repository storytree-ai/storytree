# Forest / Library on the same globe — ADR-0660 D4

Forest opens by default. Library hides the shell and every story layer, leaving the existing
knowledge points alone. The control uses the page's existing styling. There is no mode
persistence, flat view or Look-inside mount.

| Mode | Front | Quarter turn | Islands submitted | Points submitted | Shelf points | Centre cluster |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Forest | [picture](forest-front.png) | [picture](forest-quarter-turn.png) | 8 | 629 | 77 | 552 |
| Library | [picture](library-front.png) | [picture](library-quarter-turn.png) | 0 | 629 | 77 | 552 |

Counts are asserted at **both** angles, using temporary `onBeforeRender` counters around the
actual Three renderer. “Submitted” counts unique islands with submitted meshes, and individual
submitted point meshes; it does not claim every point occupies an unoccluded pixel. Library
submits no other mesh. Scene inventory separately confirms no islands, pathways, island labels,
claims or failure markers remain. The same checks compare the scene, camera and point-layer
identities, rotation, zoom and every point position across switches, then compare the restored
Forest geometry and pathways. These are assertions, not a visual census.

[The census](measurements.json) finds 73 shelf artifacts at depth 1, three at depth 2 and one at
depth 3. The 552 no-shelf artifacts still have no depth and use the existing 0.04-radius cluster.
That dense cluster reads as a bright disc in these pictures; this change preserves ADR-0658's
placement and drawing. The input is the supplied **real snapshot**, not #120's fallback seed:
`~/storytree-lanes/snapshots/2026-09-27T11-59-47-107Z.json` (taken 2026-09-27 11:59:47 UTC),
restored only into a throwaway `STORYTREE_HOME`. It has eight stories, 57 capabilities and 102
links (74 local, 28 cross-story). `seed.json` exports it through the desktop's existing reads.

Renderer: **headless Chromium 148.0.7778.96, ANGLE / Vulkan 1.3.0 SwiftShader (Subzero)**.
The raw 1440×960 PNGs are screenshots of the actual desktop renderer with its bridge supplied
from that read-only export. Observation hooks expose existing scene/navigation state only.
The .json files beside the pictures contain the measured meshes, points, camera and renderer.
No page, asset or shader errors occurred. Existing Three.Clock deprecation and SwiftShader
ReadPixels performance warnings were observed.

## Failure and interaction proof

[interactions.json](interactions.json) records an explicitly synthetic browser-only copy of the
snapshot, with one landed failing capability and one current claim. Forest opens toward the
failure; a half turn leaves its edge marker visible. Library removes it, and Forest restores it.
Clicking the marker reveals the failure and picking the island opens its panel. Library clears
selection and closes the panel; clicking that hidden island's old position cannot select it.
Orbit and zoom in Library survive switching back. A reload opens Forest again. No library writes
are made for these diagnostic states.

The focused Node test in `../../planet-view.test.ts` also proves Forest never hides failure
attention and only explicit Library suppresses its marker. [red.txt](red.txt) preserves the two
unit assertion failures and the missing-control browser failure after red commit `ef8a833`
was committed and pushed. The green run passes all these checks.

## Reproduce on this box

```sh
# Only when re-exporting: restore the supplied snapshot into a fresh, disposable home.
TASK_FOREST_HOME=$(mktemp -d)
STORYTREE_HOME="$TASK_FOREST_HOME" node --import tsx scripts/restore-library.mjs \
  ~/storytree-lanes/snapshots/2026-09-27T11-59-47-107Z.json
STORYTREE_HOME="$TASK_FOREST_HOME" node --import tsx \
  packages/forest/src/view/evidence/forest-library-toggle/export.mjs

node --import tsx packages/forest/src/view/evidence/forest-library-toggle/measure.mjs
node packages/forest/src/view/evidence/forest-library-toggle/build.mjs
flock /tmp/storytree-heavy.lock node packages/forest/src/view/evidence/forest-library-toggle/capture.mjs
```

The harness was adapted from #120. `PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` override its existing
Mint paths. It closes the browser and HTTP server in `finally`; the export stops its Postgres.

## Laptop smoke and library handoff

The small desktop flag clicks the real mode button and checks its pressed state before capture:

```sh
pnpm desktop:smoke --forest-mode forest --screenshot smoke-forest.png
pnpm desktop:smoke --forest-mode library --screenshot smoke-library.png
```

Electron could not be run on this box without a desktop display. The parser test passes and the
browser exercises the actual control; the laptop supervisor runs the two Electron captures.
The existing smoke inventory still reports the loaded forest model; it is not a measurement of
Library's visible islands. The renderer-submission assertions above supply that measurement.

Apply the [library patch and checklist](library-update/README.md) after merge. They update
Forest capability 3 and Knowledge core capability 1 without creating a new decision record.
Library text pending: applied by the laptop supervisor. No owner decision remains.

Librarian pass: these as-built and narrowing updates are handed off in that patch. No session
memory needed graduation, no decision record changed, and no additional guidance curation was
needed. No new owner redirection or evidence-supported friction item arose.
