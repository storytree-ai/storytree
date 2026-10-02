# Code growth in dependency rows

Refreshed for `increment_f4898f03a8ea` on 2026-10-02, following the geometry refresh
in `increment_bdcb6eabee69`. The original eight-story,
58-capability snapshot and code survey remain fixed. The actual desktop renderer
now supplies evidence for the accepted row placement in ADR-0839 D1–D3, including
ADR-0850's latitude bounds. A story's anchor is its packed row position; the
superseded permanent spiral is no longer a measurement baseline.

| Scenario | Input | Picture |
| --- | --- | --- |
| before | No survey; capability-sized islands | [before.png](before.png) |
| after | The recorded [file-circles survey](../file-circles/survey.json) | [after.png](after.png) |
| nudged | The agent link's recorded code doubled | [nudged.png](nudged.png) |
| grown | Every story's recorded code multiplied by five | [grown.png](grown.png) |

Each scenario computes its expected layout through `storyNodes(tree, changes,
scenarioSurvey)`, `forestScene` and `planetLayout`. The capture independently reads
the rendered island directions, coast reaches, areas and shell radius. Every
rendered direction agrees with that scenario's layout within `1e-8`; every story
in a deeper row remains north of every story in a lower row. The capture uses the
shared runner and fake bridge, dismissing the first-run menu through its real
Close control. No product code or library records are changed.

| Scenario | Globe radius | Core reach | Drawn land | Minimum sea between reaches | Core points |
| --- | ---: | ---: | ---: | ---: | ---: |
| before | 218.00 | 183.1200 | 22,793.7 | 12.0000 | 78 |
| after | 218.00 | 183.1200 | 22,965.3 | 12.0000 | 78 |
| nudged | 218.00 | 183.1200 | 29,854.7 | 12.0000 | 78 |
| grown | 222.36 | 186.7824 | 103,071.8 | 12.0000 | 78 |

The doubled agent-link island moves itself and The knowledge core along their
shared middle row. The other six islands retain exactly the same rendered
directions as `after`. The globe remains at radius 218. At five times the code,
the globe and core grow by 2%; all 78 eligible points remain. Every scenario
asserts the 12-unit sea gap with a `1e-4` tolerance for rendered Float32 vertices.
These assertions preserve Story nodes 1.7 and 1.8 under today's row-based anchors.
Full measurements, row/slot assignments and direction errors are in
[measurements.json](measurements.json). Browser page errors: zero.

The before/after/nudged pictures show distinct rows, readable labels and larger
land for larger code counts, consistent with **Meaning outranks appearance**.
The doubled island visibly spreads its row without shifting the upper and lower
rows. The five-times stress picture now also pins **Legible at the resting view**:
The library's near-side name stays above the Sessions strip, at the same seeded
opening, viewport and zoom. The original occlusion remains in
[grown-before.png](grown-before.png), copied from the previous committed capture.

| Sessions state | Name bottom (px) | Strip top (px) | Clearance (px) | Picture |
| --- | ---: | ---: | ---: | --- |
| Expanded, before fix | 916.898 | 885.609 | -31.288 | [Original](grown-before.png) |
| Expanded, fixed | 882.609 | 885.609 | 3.000 | [Readable name](grown.png) |
| Collapsed, fixed | 916.898 | 923.000 | 6.102 | [Header only](grown-collapsed.png) |
| Reopened, fixed | 882.609 | 885.609 | 3.000 | [Readable name](grown.png) |

Contracts 3.4 and 7.17 are checked against the actual rendered name and strip
rectangles, including visibility and near-side facing. Collapse and reopen use
the real header control and wait for the name to move without forcing a WebGL
redraw. The name lifts only where the strip covers its horizontal position;
collision settlement keeps neighbouring names apart, with ADR-0855's 140px
collision-clearance bound measured from that lifted resting position.

The forest remains at the rim. This evidence proves the targeted strip clearance,
growth and coast clearance, not universal label legibility: ADR-0855 still permits
hiding names where bounded overlap clearance cannot fit them. There is no camera
panning or viewport enlargement to hide that limit.

The baseline failed before opening Chromium because `placeOnPackedGlobe` is no
longer exported. The refreshed capture passed all four scenarios in Chromium
148.0.7778.96, ANGLE/SwiftShader, at 1440 × 960, device scale 1. Reproduce from the
checkout root, with installed Playwright Chromium or `CAPTURE_CHROMIUM`:

```sh
node packages/forest/src/view/evidence/growth/build.mjs
node --import tsx packages/forest/src/view/evidence/growth/capture.mjs
```

The default run writes to the temporary `storytree-captures/` folder. Add
`--retake` to replace these pictures and measurements. This is synthetic browser
evidence; it makes no laptop or Windows acceptance claim.
