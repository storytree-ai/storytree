# File circles on the territories (ADR-0804 D3)

Increment `increment_e5ff971b546b`, arc "Code islands". Every surveyed code file is a flat pale disc
lying on its capability's territory; its diameter grows with the file's lines (1.3 + 0.24 * sqrt(lines),
scaled per island so the circles cover at most 45% of it); pointing at one shows a label "path ·
N lines · capability title". This is a picture for the owner to judge; nothing here is recorded as
accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Resting front view, all eight islands | [front.png](front.png) |
| Close-up (camera zoom x2.6) on The agent link | [close-up.png](close-up.png) |
| Hover on the agent link's largest circle (`src/readings.ts`, 384 lines) | [hover.png](hover.png), cropped [hover-crop.png](hover-crop.png) |
| Hover on its largest circle whose middle lies on its own territory (`src/activity/activity-log.ts`, 343 lines) | [hover-on-territory.png](hover-on-territory.png), cropped [hover-on-territory-crop.png](hover-on-territory-crop.png) |

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1.
Seed: the same eight-story, 58-capability snapshot as [../territories](../territories/README.md), with
`survey.json` regenerated here (`tsx survey.mjs`, `readCodeSurvey` over this checkout's **main** code)
after the circles changed. Run `build.mjs`, then `capture.mjs`, under `flock /tmp/storytree-heavy.lock`.
Full numbers, including per-circle detail for the largest, are in [measurements.json](measurements.json).

## After the fix (this capture)

The first capture of this branch found 128 of 253 circle middles in the sea and circles covering up
to 101% of an island: territories and circles were laid out on a round disc and scaled to the coast's
furthest point. Now both are laid out inside the island's actual coast (seeds and circle spots kept
only on the land, the 45% cover measured against the land's area), and circles are drawn at 0.5
opacity so the territory tints read through them. Re-captured, per island (circles / surveyed files /
middles on their own territory / smallest and largest radius in plate units):

| Island | Circles | Files | On own territory | Min radius | Max radius |
| --- | --- | --- | --- | --- | --- |
| The agent link | 89 | 89 | 89 | 0.82 | 3.00 |
| The app | 26 | 26 | 26 | 1.14 | 2.04 |
| The arc surface | 19 | 19 | 18 | 0.82 | 1.93 |
| The command line | 26 | 26 | 26 | 0.89 | 2.62 |
| The forest | 26 | 26 | 26 | 1.01 | 2.78 |
| The knowledge core | 14 | 14 | 14 | 0.89 | 3.56 |
| The librarian | 17 | 17 | 17 | 0.77 | 2.00 |
| The library | 37 | 37 | 37 | 0.82 | 3.77 |

252 of 253 middles lie on their own drawn territory (one on The arc surface sits on a cell the coast
clips to a sliver). Hover label: `src/readings.ts · 384 lines · 5 · Claims`. The sections below are
the first capture's, kept for the record; their numbers are from before the fix.

## Measured before looking

Radii are in ground (plate) units, read from the drawn meshes. "Inside" means the circle's middle lies
in the triangles of the territory mesh of its own capability (or "unclaimed"). Overlap is counted as
pairs whose middles are closer than the sum of their radii; "cover" is the circles' summed area over
the island's ground area.

| Island | Circles / surveyed files | Middles inside own territory | Min radius | Max radius | Overlapping pairs | Cover |
| --- | --- | --- | --- | --- | --- | --- |
| The agent link | 89 / 89 | 38 | 1.53 | 5.61 | 22 | 101% |
| The app | 26 / 26 | 11 | 3.02 | 5.39 | 10 | 84% |
| The arc surface | 19 / 19 | 11 | 2.78 | 6.53 | 3 | 69% |
| The command line | 26 / 26 | 12 | 3.46 | 10.19 | 1 | 89% |
| The forest | 26 / 26 | 12 | 2.45 | 6.75 | 6 | 55% |
| The knowledge core | 14 / 14 | 4 | 2.50 | 9.99 | 4 | 85% |
| The librarian | 17 / 17 | 12 | 2.93 | 7.61 | 4 | 61% |
| The library | 37 / 37 | 17 | 2.15 | 9.88 | 9 | 77% |

- Every surveyed file has a circle (253 of 253). Every island has its `file-circles` group.
- **Only 125 of 253 circle middles lie inside their own territory (49%).** The count of middles that
  lie on the island's ground at all is the same 125, so the rest (128) are in the sea, outside the
  coast: on The agent link 51 of 89. Cause not established here (the territories are cut to the coast
  but the circles are not, and the circle positions come from the round pre-coast layout).
- Hover label text, read from the page's tooltip:
  - `src/readings.ts · 384 lines · 5 · Claims` (radius 5.61, the agent link's largest circle; its middle is in the sea)
  - `src/activity/activity-log.ts · 343 lines · 6 · Agent tools (the MCP server)` (radius 5.37, on its territory)
- No page errors; one Three.Clock deprecation warning, as before.

## What the pictures show, and what to judge

- **Legible at the resting view; meaning outranks appearance.** At rest the circles read as a
  scatter of pale dots around and over each island, sizes visibly graded (smallest about 1.5
  units, largest about 10). They are pale (#e9eef0 at 0.7 opacity) on a low-contrast tint, so the
  territory tints and their borders are now largely covered on the busier islands (The agent link
  covers 101% of its ground area in summed circle area). Judge whether the territories stay readable
  under the circles.
- **Circle size range.** Radii run 1.5 to 10.2 ground units across the seed. The largest circles
  (The command line's 10.2, The knowledge core's 10.0, The library's 9.9) are as wide as a large part
  of a small island; judge whether one big file dominating its island is the wanted reading.
- **A circle that does not sit on its territory is a defect, by the marks' own meaning** (a circle
  says "this file belongs to this capability's land"). In [close-up.png](close-up.png) roughly half
  the circles ring the islands in open sea, including the agent link's largest ([hover.png](hover.png)).
  I did not judge this a pass: it breaks the meaning of the mark, and the measure above quantifies it.
- **Overlap.** 59 overlapping pairs across all islands, 22 on The agent link; overlapping circles
  show as a brighter lens, so overlap is visible but the two files are not separable inside it.
- **Hover.** The label sits under the cursor, readable on the dark sea and on the tint. Its text is
  the specified "path · N lines · capability title" and a long capability title wraps onto a second
  line ([hover-on-territory-crop.png](hover-on-territory-crop.png)). The pointed circle itself is not
  highlighted, so at the resting zoom of a busy island it is hard to tell which circle the label
  names.

## Problems seen

1. Half the circles (128 of 253) lie outside their island's coast (above). Not fixed here: the code
   is outside this capture's folder.
2. Summed circle area is up to 101% of an island's ground area (target: at most 45% of the island),
   so the cap is evidently measured against something larger than the coast's ground (probably the
   round pre-coast disc).
3. No hover highlight on the pointed circle.
