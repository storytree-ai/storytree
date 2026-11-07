# Less busy map, round 1: six ways to give the land more room

Mock options only (increment_ff4990704734 on arc_9bbaa3497530). Nothing here changes product code or records a decision
about the look. Mick picks which option, if any, gets more iterations; that is a later increment.

Mick, by voice (2026-11-06): "if I look at the flowchart, the flowchart in some ways is easier to consume. And I suspect
it's because there is a lot of space between the nodes in a flowchart ... this mocking exercise would be to mock different
ways to expand the space in the border. And that way, maybe you could have the gates in the middle and like a pathway
leading through the border."

The stills are in the evidence bucket under #570 (kept 90 days, or until the arc closes), named below by their path there;
the pull request body links each one. `tools/capture.mjs` takes them again.

**How it was made.** Each option is the desktop app's own page (the look ADR-1236 rolled out, as `packages/forest` draws
it today) with one idea changed. `tools/variants.mjs` lists each option's edits to the map's code, and `tools/build.mjs`
applies them while bundling (the page and both of its workers), so no product file changes. The map is storytree's own
(the capture kit's `code-rows` snapshot). Every option uses the same views: The library at rest; a close-up of the gate
that carries the most links in today's look, framed on the gate carrying the same links in each option; and The command
line at rest. (This round uses the real app rather than `q-all-islands/`: that mock's overlay no longer matches the map
it sits on, which has since built the look itself.)

## The options, side by side

| | The library, at rest | Close round a gate | The command line, at rest |
| --- | --- | --- | --- |
| **Today** | `570/docs/design/capability-tree-3d/r-room/stills/today-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/today-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/today-second-rest.png` |
| **A** | `570/docs/design/capability-tree-3d/r-room/stills/A-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/A-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/A-second-rest.png` |
| **B** | `570/docs/design/capability-tree-3d/r-room/stills/B-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/B-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/B-second-rest.png` |
| **C** | `570/docs/design/capability-tree-3d/r-room/stills/C-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/C-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/C-second-rest.png` |
| **D** | `570/docs/design/capability-tree-3d/r-room/stills/D-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/D-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/D-second-rest.png` |
| **E** | `570/docs/design/capability-tree-3d/r-room/stills/E-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/E-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/E-second-rest.png` |
| **F** | `570/docs/design/capability-tree-3d/r-room/stills/F-library-rest.png` | `570/docs/design/capability-tree-3d/r-room/stills/F-library-gate.png` | `570/docs/design/capability-tree-3d/r-room/stills/F-second-rest.png` |

## What each one changes, and what it costs

- **A · Open ground between territories.** Neighbouring territories are pulled apart: where two meet, the bigger one gives
  up its edge to a street of bare open ground. Every territory becomes a plateau on that ground, and the roads run along
  the streets and climb ramps into the territories. *Cost:* the territories keep about two thirds of the land (The library
  68%, The command line 73%), so the island would need to be about 1.4 to 1.5 times its land (about 20% wider each way) to
  give each territory back its size. The layout is also searched again, so territories move. Gates now stand at the ramps
  where roads leave the open ground (The library 12, down from 16), so no gate stands between two territories.
- **B · Thick borders.** Each border is a pale band 1.3 units wide, broken where a gate or open road crosses, in place
  of today's thin line. *Cost:* the island stays the same size, but the bands take a strip off every territory's edge, and
  with so many borders the island reads as a pale web; gates read as gaps in the band.
- **C · A border lane, with the gate in the middle and the road through it.** Between every two neighbouring territories
  runs a lane of bare ground 2.6 units wide, unbroken. The road crosses it on top, and the gate's posts stand on its middle
  line, as Mick described. *Cost:* the island and its layout stay the same, but the lanes take a wider strip off each
  territory than B does. At rest, the many winding borders turn into a dark network that competes with the roads.
- **D · Quieter fills.** Each territory's colour is drawn at two fifths of its strength, so the roads, gates and
  settlements carry the picture, the way a flowchart's lines and boxes do on a plain page. *Cost:* no change to size or
  layout, but health reads weaker: green, yellow and red become olive tones, and a yellow territory stands out less.
- **E · Fewer marks: no gate posts, no settlement symbols.** A gate is only the gap in a border where a road crosses, and a
  settlement is only where the roads end. *Cost:* no change to size or layout, but you no longer see what kind of thing
  each settlement is (store, service, queue ...) or where exactly a pair's gate is, until a click or a zoom adds them back.
  At rest it changes little: today's posts and symbols are already small from far.
- **F · A bigger island, with the marks kept the same size.** The layout is drawn as if every island had 2.25 times its
  land (1.5 times each way) round marks of today's size. Gates, posts, roads, symbols and ramps stand two thirds as large
  against their territories, so there is more space between them. *Cost:* drawn at the island's real size, every mark is
  two thirds as large on screen (posts and symbols get hard to read at rest). Kept at today's size on screen, each island
  takes 2.25 times the map's area. The layout is searched again, so territories move.

| | Territory land, The library | Gates, The library | Territory land, The command line | Gates, The command line |
| --- | ---: | ---: | ---: | ---: |
| Today | 12,735 | 16 | 5,122 | 11 |
| A | 8,615 (68%) | 12 | 3,764 (73%) | 13 |
| B, C, D | as today (B and C paint over a strip of it) | 16 | as today | 11 |
| E | as today | 0 posts drawn | as today | 0 posts drawn |
| F | 13,042 | 17 | 5,154 | 13 |

Territory land is the area of the territories' meshes in the island's own units. Gates are gates whose posts are drawn
(`stills/measurements.json`).

## What we make of it (not binding)

Mick's flowchart instinct is about space *between* nodes. A and C are the two options that put space there; B and D only
change how the edges and fills are inked. A gives the clearest flowchart-like separation (plateaus on open ground, roads
in the streets between) but costs the most land. C is closest to what he described (a gate in the middle of a pathway
through the border), but on The library's many winding borders the lanes become a second network of lines. If he picks C,
the next round would want straighter, simpler borders first. A combination such as A with D's quieter fills is also
open.

## Rebuild

Run from the checkout root:

1. `node --import tsx docs/design/capability-tree-3d/r-room/tools/build.mjs [option ...]` builds each option's page into
   the checkout's ignored `.evidence-builds/`.
2. `node --import tsx docs/design/capability-tree-3d/r-room/tools/capture.mjs [option ...] [--retake]` builds and takes
   each option's three views and their measures. Run `today` first: the other options are framed on its gate. Without
   `--retake` the stills go to the capture kit's scratch folder. `REST`, `CLOSE` and `SECOND_REST` change the zooms, and
   `SECOND` names the second island.
