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
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx \
  packages/forest/src/view/evidence/pathway-repair/build.mjs "$PWD" after
CAPTURE_CHROMIUM=/usr/bin/google-chrome \
PATHWAY_CAPTURE_OUT=/home/mickh/storytree-lanes/pathway-repair-20261007/captures/after \
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx \
  packages/forest/src/view/evidence/pathway-repair/capture.mjs after --retake
CAPTURE_FFMPEG=/home/mickh/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux \
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx \
  packages/forest/src/view/evidence/pathway-repair/clip.mjs \
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
The documented command wrapper takes the current gate/test lock. It coordinates
participating commands only; uncontrolled competing work still prevents these
timings from being controlled benchmarks.

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
`PATHWAY_CAPTURE_OUT` at a fresh output folder, then use the command wrapper above with
the matching label. Rebuild from the intended checkout to capture changed product
code. Keep the source bundle outside an automatically cleaned worktree if its exact
baseline must survive the landing.

## Live beige crossing roads, third increment

This increment enables ordinary **cross-island beige ribbons** in the desktop to
grow on the first display and when a dependency arrives through the live poll.
It leaves inland wear unchanged. The earlier selection-colour captures do not
stand in for this behavior.

| Actual desktop view | Evidence |
| --- | --- |
| First display, roads still growing (opening camera) | [Initial partial compositor frame](after-live-first-display-mid.jpg) |
| Same first display, completed | [Initial completion](after-live-first-display-complete.png) |
| Settled 130-link graph, before restoring the dependency (camera faces the two islands) | [Before addition](after-live-before-addition.png) |
| Restored beige crossing growing out of The library | [Addition partial compositor frame](after-live-addition-mid.jpg) |
| All 131 saved links restored | [Addition completion](after-live-addition-complete.png) |
| Live addition at the actual compositor timing | [Before repair](before-live.webm) · [After repair](after-live.webm) |

The fixture removes only Agent tools' saved dependency on Library API before
navigation, then restores its exact original dependency list through a normal
capability-update record. The desktop's existing two-second poll rereads the tree.
No dependency is invented; the restored graph is exactly the saved 131-link graph.
The selected route has two new-only spans, including one 97.671-unit crossing, and
26 shared spans, including two crossings. Classification uses the original
capability-link identities, never segment-ID stability.

The first-frame observer is installed through the shared kit's capture seam at
Canvas creation, before the first `gl.render`. It records geometry submitted by
the real renderer, without changing time or requesting animation frames. The
probe waits for initial completion before moving the camera and before restoring
the dependency. It again waits without invalidation for the new road to finish.
The separate opening pictures set only the returning user's existing guide-dismissed
preference, so Help does not cover the forest; the 130-link data and renderer are
the same. Their compositor starts recording before page navigation.

[Live measurements](live-measurements.json) includes the initial frame traces,
physical addition fronts, renderer identity, bundle hashes and exact link identities.
Both bundles remain outside the checkout in the lane's `captures/bundles/before-live`
and `captures/bundles/after-live`; the baseline is clean commit
`12dc3d9c834bab0f60343b1d3979e19495233c79`. Full traces are in `captures/before-live/`
and `captures/after-live/`; opening compositor pictures are in
`captures/after-live-initial/`.

| Observed behavior, Chrome 151 / ANGLE Vulkan SwiftShader | Before | After |
| --- | --- | --- |
| First normal frame of the initial 130-link graph | All 28 crossing ribbons whole | All 28 undrawn |
| Initial partial render frames | 0 | 10 |
| First frame of the restored new-only crossing | Whole | Undrawn |
| Partial render frames of that crossing | 0 | 4 |
| Existing/shared crossings during restoration | Complete | Complete |
| Final link identities | All 131 | All 131 |
| Unrelated description update after completion | Complete | Complete |
| Reduced-motion initial and addition first frames | Complete | Complete |

The added strip's actual drawn vertex pairs advance from the Library end toward
the shared trunk leading to Agent tools (`fromEnd: true` for this segment).
Existing route geometry can move as the router rebuilds the plan; its completed
roads remain drawn. Both normal animations finish on demand. No coloured selection
lane is mounted, and both pages report zero errors.

The numbered real-browser test
[`desktop-renderer-smoke.test.ts`](../../desktop-renderer-smoke.test.ts) protects forest
3.35. Against the immutable baseline it failed with “new-only beige spans begin
undrawn; observed [1]”. The corrected product passes, including initial growth,
in about 20 seconds on this machine. The smoke takes no pictures and retains its
first-frame trace in the capture kit's scratch output. It uses the same real desktop
bundle and browser as the full capture; CI's installed Chrome needs no download.

The smoke uses a 320 × 240 viewport with the same 131-link scene and reads the real
world-space geometry. It omits picture framing, Help interactions and camera
settling; full captures remain 1440 × 960. CI previously passed in 46 seconds on
Windows and 59 seconds on Linux, while macOS reached the old 80-second subprocess
deadline. Its next run identified the initial roads' 15-second completion wait.
Growth advances with rendered frames, so slow rendering stretches wall time: both
real browser smokes passed together on one CPU core in 97.56 seconds, with initial
roads advancing through 14 frames over 7.68 seconds and frame gaps up to 1.52 seconds.
No local demand-render stall was reproduced. The initial completion allowance is
now 30 seconds; the capture remains bounded at 120 seconds inside the test's
155-second limit. Failed stages retain elapsed phase diagnostics and a bounded
passive frame tail, including progress, redraw state, visibility and canvas size.
The next macOS run completed every behavior check and both page closures, then
exceeded the child deadline during capture cleanup. After all observations and
pictures, the capture now cancels pending redraws and disposes its own renderer
and WebGL context before closing each page. Shutdown phases distinguish browser
disconnection from the capture server's cleanup. No observation or deadline is
changed by this cleanup.

A subsequent macOS failure trace showed all 28 initial roads complete across 15
frames, with no pending redraw and a visible canvas, while the RAF-based state
wait timed out. State predicates now poll every 100 ms, independently of rendering;
they never invalidate the globe. The same complete raw observation is transferred
as a JSON string and parsed in Node, avoiding recursive protocol serialization of
every frame. macOS requires its CI rerun to verify the complete capture lifecycle.

The unrelated-description check waits for an actual submitted frame whose territory
mesh contains that exact updated description, then checks every intervening road
frame stayed complete. A tree-read count plus a fixed half-second delay did not
establish that rendering had consumed the update. Assertion diagnostics retain
the motion mode, frame counts, consumption and progress; an empty trace cannot pass.

The pathway and territory-health browser proofs live in that one test file so Node
runs them sequentially. Separate files launched competing SwiftShader browsers
inside one forest unit despite the shared lock around the whole test run. Both
numbered behaviors retain their full fixtures, assertions and individual deadlines.

### Shared macOS package deadline

[PR #836's merge-queue macOS log](https://github.com/storytree-ai/storytree/actions/runs/37645075537/job/112873617092)
shows the preceding territory-health proof taking **131.209 seconds**, then the forest
unit being killed at its unchanged 180-second deadline with live roads pending. Only
about 44 seconds remained for live roads. That log does not establish a stuck live-road
step: child stderr was buffered until exit and was lost when the package was killed.

The territory smoke now keeps its full fixture and fill/claim
measurements and turn-away failure-marker check, but omits the four picture-only
close-ups and their zoom/unzoom tour. It requests six settling frames instead of
204 and waits explicitly for both failure markers. The full picture capture still
performs the tour. State predicates poll independently of RAF. After observation, redraws stop and
page closure releases the renderer resources.

Both numbered tests now stream subprocess phase diagnostics while retaining stdout
for the same assertions. The last live-road step and its elapsed time therefore remain
in the test log even if the outer package deadline interrupts it. The live-road fixture,
all first-display/addition/shared-road/reduced-motion assertions, and every existing
time limit remain unchanged.

The first [PR #840 macOS run](https://github.com/storytree-ai/storytree/actions/runs/37653398523/job/112902265356)
then isolated the next limit: the initial roads' 30-second wait. The territory proof
completed in about 39 seconds. Live-road telemetry showed 13 submitted frames, gaps
as large as 9.8 seconds, a visible 640 × 384 canvas and pending redraws; 27 of 28
crossings were complete while one had not started. This was slow frame delivery,
not a lost invalidation or a cleanup hang. The smoke viewport is now 320 × 240
(previously 640 × 480) to reduce software-compositor pixel work. The actual scene,
all 131 saved link identities, geometry observations and the product's clock remain
the same. Full pictures remain 1440 × 960. macOS CI and its merge-queue run verify
the complete capture lifecycle and combined budget.

The revised live-road proof passed on macOS both in its PR run and the next merge
queue (about 50 seconds each). That queue instead exposed the territory capture's
new explicit WebGL disposal step exceeding its ten-second guard after all observations.
Territory cleanup now stops redraws and leaves WebGL resource disposal to page closure,
avoiding an extra synchronous driver drain. Its smoke viewport is 640 × 480, reducing
pixel work while retaining all territory/claim geometry and both failure markers;
full picture captures remain 1440 × 960. No behavior assertion or existing timeout
was removed or enlarged.

Use the command wrapper from above, with `PATHWAY_CAPTURE_DIST` naming the intended
bundle and `PATHWAY_CAPTURE_OUT` naming its output:

```sh
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/pathway-repair/live-capture.mjs after-live --retake
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/pathway-repair/clip.mjs /path/to/after-live --live
# Optional separate opening pictures, before the first road frame:
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/pathway-repair/live-capture.mjs after-live-initial --initial-only --retake
```

Use a separate output folder for the optional opening run. Video encoding retains
the observed compositor timing, including the poll delay, and holds real pictures
between frames; it does not generate intermediate motion. The capture allows the
software compositor to present the final submitted frame before stopping its video.
