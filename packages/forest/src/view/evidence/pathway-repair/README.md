# Pathway destinations and motion

These captures load the real desktop renderer, using the committed
[`code-rows/seed.json.gz`](../code-rows/seed.json.gz) and
[`survey.json`](../code-rows/survey.json). They select The agent link, whose thirteen
cross-story capability links are retained. The bridge supplies saved library data;
it does not replace the product's drawing. The shared desktop capture kit owns the
build, server, Chromium launch and cleanup.

`capture.mjs` records each actual Three.js render submission and a passive Chrome
compositor screencast. It does not invalidate the canvas during the measured
selection interval, change the product's clock, or insert intermediate pictures.
The only observation wrapper reads geometry immediately before `gl.render`.
Camera changes and bounded settling happen outside that measured interval.

The normal-motion sequence runs from deselection through the completed selection.
A separate resize and identical rotation checks a camera-only update. The harness
also changes an unrelated mapped capability's description in its saved bridge data
and appends a normal capability update. The desktop's actual two-second poll rereads
the tree; neither a page reload nor a forced redraw delivers that change. Reduced
motion records the first submitted lane frame. The close views
only increase the camera zoom and retain the product's territory meshes and labels.

## Repeat

Run from the owning worktree through the command wrapper below. It acquires and
releases the same `acquireHeavyLock` used by `pnpm gate` and `pnpm test`, from
`packages/dev-loop/src/heavy-lock.mjs`. This is command orchestration outside the
forest package; the evidence scripts do not import the dev loop's private files.
Its default lock file is `~/.storytree/0.3/heavy-run.lock` (`STORYTREE_HOME` can
change the directory). Set the
output folder to a scratch/evidence destination. `--retake` means that destination
is intentional; the default writes under `/tmp/storytree-captures`.

```sh
capture_locked() {
  node --import tsx --input-type=module -e '
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    import { acquireHeavyLock } from "./packages/dev-loop/src/heavy-lock.mjs";
    const release = await acquireHeavyLock({ root: process.cwd(), what: "pathway evidence" });
    try { await import(pathToFileURL(path.resolve(process.argv[1])).href); }
    finally { release(); }
  ' "$@"
}
capture_locked packages/forest/src/view/evidence/pathway-repair/build.mjs "$PWD" after
CAPTURE_CHROMIUM=/usr/bin/google-chrome \
PATHWAY_CAPTURE_OUT=/home/mickh/storytree-lanes/pathway-repair-20261007/captures/after \
capture_locked packages/forest/src/view/evidence/pathway-repair/capture.mjs after --retake
CAPTURE_FFMPEG=/home/mickh/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux \
capture_locked packages/forest/src/view/evidence/pathway-repair/clip.mjs \
  /home/mickh/storytree-lanes/pathway-repair-20261007/captures/after
```

For the baseline, `PATHWAY_CAPTURE_DIST` names the already-built
`code-rows/dist/before` folder (baseline checkout `38cff76a`), so concurrent product
edits cannot contaminate its bundle. The script otherwise uses its own
`dist/<label>`. Build the after bundle from the changed worktree.

`clip.mjs` encodes the captured JPEG sequence at its recorded compositor timestamps,
rounded to 1/25 second. It holds the last real picture between compositor frames;
it never synthesizes additional motion. `measurements.json` retains exact timestamps
and the complete render trace, and `normal-frames/frames.ffconcat` supports a full
ffmpeg installation as another encoding route.

## Baseline observation, 2026-10-07

Artifacts: `/home/mickh/storytree-lanes/pathway-repair-20261007/captures/before/`.
Chrome 151.0.7922.173, ANGLE Vulkan SwiftShader, 1440 × 960, device scale 1, dark
theme. No page/console errors; one Three.Clock deprecation warning.

The recordings in `before/` and `endpoints/` used only the older outer
`flock /tmp/storytree-heavy.lock`. That is a different file from the current
gate/test lock, so those recordings cannot claim controlled isolation from other
heavy machine work. Their frame timings describe those observed runs only.
The documented command wrapper takes the current gate/test lock; an additional
legacy outer `flock` is optional and does not replace that wrapper.

- Thirteen coloured lanes appear for the thirteen real cross-story links.
- Twelve render submissions during selection include ten partially drawn frames.
  The first lane fractions are 7–12%, with no initial full-frame flash observed.
- Demand rendering reaches the completed state without capture invalidation.
- Median frame spacing is 91 ms; the largest gap is 536 ms. Across that gap,
  the mean mesh reveal fraction jumps from 19.6% to 92.6%. This software-renderer
  capture demonstrates the motion's sensitivity to slow frames, not display timing
  on every GPU.
- The resize/identical-rotation update does not restart the selected lanes.
- Reduced motion draws every selected lane in full on its first render submission.
- The ordinary beige desktop roads are already whole in the first observed frame.
  This is distinct from the selection-colour draw-on and from website replay.
- `selected-detail.png` shows the existing inland branches and endpoints against
  the actual territory labels. The separate endpoint diagnostic establishes which
  named territory owns each endpoint; the screenshot alone does not identify links.

No product rendering is accepted by the capture author; the pictures and measurements
are evidence for review alongside the numbered behavior tests.

## Correct destinations, first increment

| View | Before | Territory endpoint seam |
| --- | --- | --- |
| The agent link selected | [Before](before-selected.png) | [After](endpoints-selected.png) |
| Its inland endpoints against the visible territories | [Before detail](before-selected-detail.png) | [After detail](endpoints-selected-detail.png) |

The second build uses the same saved data, camera, viewport and thirteen selected
link identities. [Measurements](measurements.json) includes the two actual bundle
hashes, renderer identity and summaries. Full traces and original pictures remain
in the lane's `captures/before/` and `captures/endpoints/` folders.

The separate product-geometry diagnostic reports all **62 linked capabilities that
have visible territories ending inside their named territory**, out of 78 linked
capabilities checked. **Sixteen linked capabilities have no visible territory in
this saved code survey**. They retain their existing fallback endpoint; this repair
does not invent a territory or delete their links. The agent link has eight linked
capabilities with visible territories and two without them (Agent activity log and
Instructions). The original diagnostic reported 68 of 78 endpoints outside their
named territory; after the repair, the remaining sixteen are exactly those without
a visible territory. Claims and Agent tools now reach the areas named on screen.

All 131 fixture links remain. Correcting their destinations changes the selected
inland routes from 29 to 35 local segments and from six to eight branch junctions;
the number of segments carrying both colours changes from thirteen to fourteen.
These pictures establish corrected destinations, not a resolved clutter policy.
Shared lane readability and motion are the next increment on the same arc.

The endpoint capture still finds no initial full-frame flash, demand-render stall,
camera-update restart, or reduced-motion failure. Its ten normal render frames
include nine partial frames (94 ms median spacing, 555 ms maximum); its ordinary
beige roads also start whole. The first increment does not claim to repair motion.

Repeat this stage by passing `endpoints` in place of `after` to the build and
capture commands and naming `captures/endpoints` as the output folder.

## Physical selection fronts and distinct shared colours, second increment

| View | Endpoint-fixed baseline | Motion and shared lanes repaired |
| --- | --- | --- |
| The agent link selected | [Before](before-motion-selected.png) | [After](after-motion-selected.png) |
| Distinct cyan and violet lanes inland | [Before detail](before-motion-selected-detail.png) | [After detail](after-motion-selected-detail.png) |
| Directional draw-on at observed compositor timing | [Before clip](before-motion.webm) | [After clip](after-motion.webm) |

Both recordings use the current gate/test lock, Chrome 151 with ANGLE Vulkan
SwiftShader, and the same seed, survey, viewport and scripted camera. These are real
desktop frames with saved bridge data. The baseline bundle is preserved outside
the worktree at the lane's `captures/bundles/before-motion/`; its source map contains
`lanes.ts` and `PlanetTrailRibbons.tsx` byte-for-byte identical to commit
`8f5c66c29ab2169490041ebb4d4eb56c0b5235fa`. The after bundle is likewise preserved
at `captures/bundles/after-motion/`. Full pictures, compositor frames and traces
live in `captures/before-motion/` and `captures/after-motion/`.

[Motion measurements](motion-measurements.json) retains the bundle hashes, physical
front trace, exact thirteen link identities, direction checks, shared-route
measurements and source validation. Before, physical distance is measured from the
submitted mesh's centreline and draw range. After, the renderer exposes
`geometry.userData.pathwayReveal`, whose interpolated final vertex pair is also
protected by the numbered product test.

| Observed behavior | Before | After |
| --- | --- | --- |
| Normal render submissions / partial frames | 6 / 5 | 18 / 16 |
| First submitted physical front | 6.3–13.3% | 0% for all thirteen lanes |
| Largest frame gap | 821 ms | 571 ms |
| Mean physical front across that gap | 18.2% → 99.7% | 3.4% → 10.9% |
| Actual polled description update | Completed lanes restart (minimum observed front 15.0%) | Every submitted front stays complete |
| Reduced-motion first submitted frame | Complete | Complete |
| Shared cross-road opposite-colour separation at its midpoint | 0 | 1.924 ground units |

Both runs complete on demand without capture invalidation and draw from dependency
to dependent. The unrelated description update changes only The forest's Story node
render description, outside the selected story and its neighbours. It causes a real
tree reread (1 → 2) while preserving all 131 fixture links and all thirteen selected
lanes. The earlier resize-only probe could not expose this restart fault.

The complete geometry check covers fourteen segments shared by both colours:
thirteen inland and one between islands. Every segment separates in its interior;
the maximum separation per segment ranges from 1.200 to 2.312 ground units against
0.9-unit strips. The lanes taper together at actual junctions, preserving continuous
link identity. Those tapers leave about 19.5% of shared route length with overlapping
strips; this is not a claim of zero overlap or a new inland-fork policy.

Software-renderer timings describe these recorded runs, not all GPUs. The after
clip stretches wall time across slow frames while keeping a visible directional
front. The ordinary beige desktop roads still appear whole in this increment;
selection-colour growth and website replay do not prove live-road growth.

To repeat, point `PATHWAY_CAPTURE_DIST` at either preserved bundle and
`PATHWAY_CAPTURE_OUT` at a fresh output folder, then use `capture_locked` above with
the matching label. Rebuild from the intended checkout to capture changed product
code. Keep the source bundle outside an automatically cleaned worktree if its exact
baseline must survive the landing.
