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
A separate resize and identical rotation checks whether an unrelated update restarts
the lanes; reduced motion records the first submitted lane frame. The close views
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
irrelevant-update restart, or reduced-motion failure. Its ten normal render frames
include nine partial frames (94 ms median spacing, 555 ms maximum); its ordinary
beige roads also start whole. The first increment does not claim to repair motion.

Repeat this stage by passing `endpoints` in place of `after` to the build and
capture commands and naming `captures/endpoints` as the output folder.
