# Knowledge beneath the islands — ADR-0658

The real 0.3 desktop page, reading its own seeded library through the normal page
API. This is the accepted points-only treatment from `spike/globe-knowledge`, with
no-shelf artifacts moved from outside the shell to a small centre cluster.

| View | Without the new layer (same seed) | Production |
| --- | --- | --- |
| Front | [Baseline](baseline-front.png) | [Faint points](production-front.png) |
| Quarter turn | [Baseline](baseline-quarter-turn.png) | [Faint points](production-quarter-turn.png) |

Raw 1440 × 960 screenshots, dark theme, device scale 1. Renderer: **headless
Chromium 148.0.7778.96, ANGLE / Vulkan 1.3.0, SwiftShader Device (Subzero)**. The
software renderer matches the look test and earlier pathway evidence. No X display,
Electron window or image retouching was used. Appearance judgment remains with the owner.

## Real-seed census

`STORYTREE_HOME=$(mktemp -d)` was used for `pnpm seed:library`; the entire seed
finished with **exit 0**, including every story's health recording and Postgres stop.
The export never opens the owner's app library. It retains the actual history and
shelf reads, without invented references, failure states or activity.

[Measurements](measurements.json) enumerate all **78 artifacts**:

- **73** at depth 1 beneath their home islands, at radius **183.12** inside the
  radius-218 shell; zero deeper artifacts because this seed has no artifact links.
- **5** with no shelf route, at radius **8.72** around the centre, with no assigned depth.
- **0** threads, ghosts, proposals or loops; **66** shelves, none empty.
- **8** islands, **58** capability trees, **103** recorded pathways (75 within stories,
  28 cross-story), all retained.

The count matches the look test. These are submitted meshes, not a claim that every
point is visible simultaneously: opaque land hides points directly behind it. Points
keep the selected muted blue-grey (`#a5c5d1`), opacity 0.52 and radius 1.308. Depth
testing stays on, depth writing stays off, and points cannot be raycast targets.

## Behaviour evidence

Each production capture asserts the exact artifact IDs, coordinates, depth, home,
point size/material and disabled picking, with only those point meshes beneath the
knowledge group and no threads. Names (including visibility and pixel bounds),
claim/failure markers, island/tree geometry and transforms, and all pathway geometry
and metadata are compared against the same seed/view without the layer. Every native
cross-story link has drawable ribbon geometry. The quarter turn is measured at 90°.
Per-view JSON records the renderer, draw counts, warnings and errors. All captures have
zero page, asset or shader errors. Existing Three.Clock deprecation and SwiftShader readback warnings appear in both
baseline and production. The earlier drei/React root-cleanup warning is gone after
main's #121 overlay-host fix.

The real seed has no failing islands or claims. A separately labelled **browser-only
copy** adds one landed failing capability and one current Codex claim. The
[interaction record](interactions.json) compares the same journey with/without points:
opening faces the failure; a 180° turn keeps its edge marker; clicking the marker
reveals it; the claim remains visible; clicking the island opens its story panel.
Diagnostic state never reaches the database or [real seed](seed.json).

- [Hidden failure](production-synthetic-failure-hidden.png)
- [Revealed failure and claim](production-synthetic-failure-focused.png)

## Main's library migration during landing

The initial checks and captures below used `6460b9c`. Main then merged #118
(`2717808`), removing the file-backed seed and making the live library authoritative.
This branch merged it at `afafede` and retained those deletions. The completed exit-0 seed is
historical evidence, not an available command on the resulting main. The
[reviewed library update](library-update/README.md) is preserved for the supervisor
with access to the migrated app library. The capture continues to reproduce from
its committed real-seed snapshot. The complete browser capture and failure/claim journey
were repeated against `afafede`, with all assertions passing and unchanged PNGs. After
`pnpm install`, locked typecheck passed again, and locked `pnpm test` reported affected
scope: desktop, arc-surface, forest, forest-world and knowledge-core, plus the package
boundary check; all six selected units PASS. This narrower run is not a fresh full-suite
proof. Main then merged #121 (`8d8a73d`) while CI was finishing; this branch merged
it at `6304348`, preserving both the stable overlay host and the knowledge component.
The browser bridge now provides the project-selection reads used by the updated page.
Installation, locked typecheck and the same six scoped units (1,562 tests) passed again.
All captures were repeated on this merged renderer. Main's later #122 panel update
(`91dd873`) merged cleanly at `6d626c6`; install, locked typecheck and the same 1,562
scoped tests passed again. Its changes are confined to the story panel; the front and
quarter-turn globe captures remain the `6304348` render. The full synthetic failure,
claim and picking journey was recaptured on `6d626c6`, including its updated panel.
The final test-ratio all row is:

```text
  all                       38,436           28,280    1.36
```

## Initial red, green and checks (before #118)

- Red **c7a7edb** was committed, pushed and [seen failing](red.txt) before implementation.
- Green **226b3ea** adds the shared capability-1 drawing coordinates and the public
  `KnowledgeGlobePoints` view mounted by forest. No knowledge story code enters the frame.
- `flock /tmp/storytree-heavy.lock pnpm typecheck`: passed.
- `flock /tmp/storytree-heavy.lock pnpm test`: **full scope**, all 12 units PASS,
  1,939 tests passed, two expected skips, none failed.
- `pnpm test-ratio` all row (report, not gate):
  `all                       38,953           28,840    1.35`

The unit proofs cover longest-chain depth, shared artifacts, their own island, filtering
of ghosts/proposals/retired artifacts, and the bounded distinct centre pool. Existing
inspection and failure-navigation tests stay green. The preserved front-cover record is uniquely
ADR-0658; ADR-0647 and ADR-0655's narrowed prose is in the library-update evidence.

## Reproduce

From this worktree's root, using the committed seed:

```sh
node packages/forest/src/view/evidence/knowledge-under-islands/build.mjs
node --import tsx packages/forest/src/view/evidence/knowledge-under-islands/measure.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/src/view/evidence/knowledge-under-islands/capture.mjs
```

To reproduce the original file-backed seed, use commit `6460b9c`, run
`STORYTREE_HOME=$(mktemp -d) pnpm seed:library` under the shared lock, retaining that
path, then run `export.mjs` with `node --import tsx` and the same `STORYTREE_HOME`.
After #118, export from a restored isolated snapshot of the actual library instead. `PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` override the
Mint paths in the capture. Append a case name or `interactions` to capture only it.
Browser, HTTP server and export Postgres close in `finally` blocks.

The instrument was borrowed from the spike, never merged or cherry-picked. Its
production bundle substitutes only the Electron read bridge with the exported data
and exposes scene/navigation observation hooks. The baseline omits only the new
inside-slot component. No production drawing is substituted for the screenshots.
