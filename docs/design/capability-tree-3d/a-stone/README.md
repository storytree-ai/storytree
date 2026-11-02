# Capability tree, round 6A: a flowchart in the map's clothes

The Library's capabilities laid out as the architecture diagram was, in layers by dependency with wide open land between
them, but drawn on the real map's island: each capability an organic patch in its health colour, sized by its lines of code.
Solid roads run through the open land and enter each called patch through its own gap in the patch's dashed outline, which
is that link's gate; the links from other stories come ashore as one road and split.

A mock only: it changes no product code (increment_0394d2ad31f3 on arc_9bbaa3497530).

![Resting view](stills/resting.png)

**Open it:** `index.html`, straight from disk; it needs no network. Drag to pan, right-drag (or Q/E and R/F) to turn and
tilt, wheel to zoom: the map's own controls. Click a patch, a road, a gate or a wrench, and the panel on the right shows what
it holds. The window is 1440 × 900 with the story panel's 352 pixels on the right, as the app lays it out; the rest view
frames the whole graph, every name in sight.

## What it is

| What | How the page does it |
| --- | --- |
| The island | The map's own island for The library, its coast, sea and the map's roads between islands as the map draws them. The map's territory cut, file dots and claim flags on this island are hidden; its land is drawn as open parchment instead. The island is given 1.6 times its lines of land (`?room=`), so the open land has room. |
| Layers by dependency | Callers above what they call, seven layers from Fixed data questions, Waits and Owner questions at the top to Project libraries at the bottom. Each capability starts at its longest path from the top, then moves to the layer, within the room its callers and callees leave it, that keeps its links shortest. The Rounds group (Rounds and the five it calls), which links to nothing else here, is laid out on its own and set beside the main graph where it is thinnest. |
| Order in a layer | Barycentre sweeps over the links (a long link counted through every layer it crosses), keeping the order with the fewest crossings: 4 crossings left between neighbouring layers. Then each patch slides toward what it is linked to, never nearer its neighbour than the open land allows. The whole plan is turned east for west when that puts the capabilities other stories call nearer the coast their roads land on (it is, here). |
| Open land | 56 plan units between patches of a layer, 125 between layers, and a 60-unit margin of land to the coast. A plan unit is about 0.6 pixels at rest, so neighbours stand about 35 pixels apart and layers about 70. |
| Patches | A rounded blob, a little wider than tall, its wobble seeded by its id so it is the same at every load; its area is 8 square units per line of code, with a floor of 160 lines so the smallest still holds its gates. Filled in the map's colour for its health at the map's opacity, its outline dashed in ink. No walls, no squares. |
| Roads | Found on a 3-unit grid through the open land: never through a patch or a name (9 units clear), dearer near a patch, much dearer along another caller's road (so roads keep apart and cross rather than run together), and cheap along the caller's own (so each caller's roads leave by one way out and split toward their gates). Pulled taut where the land allows, then rounded. Solid, 3.2 units wide. |
| Gates | One per link: a gap 11 units wide in the called patch's dashed outline, a short ink tick at each end of it, the road running through and a little way in. The roads are found twice: first with each gate facing where its link starts, then with each moved to where its road was found to come in, so no road bends round a patch to reach its gap. Gates on one patch are kept 30 units apart round its outline (an isotonic fit, each moving as little as it can). A gate's straight way in runs out until it is clear of every name. 49 gates: 27 for the links inside the story, 22 for the links from other stories. |
| From other stories | The 22 links from capabilities of 7 other stories come ashore where the map's own lanes from those stories land (the south-east, labelled "from 7 stories"), as one road that splits toward its 22 gates. The one link out, Connection by address to Keys, leaves by the coast where the map's lane to Keys sets off. |
| The wrench | The flat ink wrench of the claim flags' manner, upright and constant on screen, just inside a gate of the capability open work names (a gate from this story first). A capability nothing calls has no gate, so its wrench stands where its own road leaves it (Cloud connection (GCP), Ranked search). |
| Clicks | A patch: its health, lines, description, contracts, what it calls and what calls it. A gate: the link and the called capability's contracts (number and title), its route lit in gold edged in ink, its ticks gold. A road: one link's contracts, or every link a shared stretch carries. A wrench: every arc and increment that wants that capability. Nothing is hidden or dimmed. |
| The rest view | The map's camera tilted two steps nearer overhead by its own R key (`?tilt=0` keeps the map's opening), then framed on the plan and its names. |

## Palette

| Meaning | Hex |
| --- | --- |
| Open land | `#ddd5bd` |
| Healthy, untested, parked patches (the map's, `packages/forest/src/view/territory-land.ts`) | `#97C459`, `#F2D16B`, `#86939D`, at opacity 0.8 |
| Ink: outlines (dashed), gate ticks | `#2b261f` |
| Road | `#7a5838` |
| Lit route and gate (the selection) | `#ffc93c`, edged in `#2b261f` |
| Wrench | `#1b1814` with a `#ece4d0` edge; sample `#d6bdf0` |
| Names | the map's own nameplates |

## What is measured, and what is sample

Every number is the real library and code on 2026-11-02 (`data.json`'s `measuredAt`), read by `tools/measure.mjs` from the
project's library (`projectTree`, the open increments' capabilities lists) and the code survey the map itself uses:

- The library (story_754e87e7d531): 24 capabilities, 14,622 lines (tests excluded) in 78 files. 22 healthy; 14 · Ranked
  search untested; 8 · Cloud connection (GCP) untested and parked, so grey.
- 50 links (capability.dependsOn): 27 inside the story, 22 into it from 7 other stories (14 from The command line), and 1
  out of it, to Keys.
- Open work: three open increments each name one of these capabilities, so three wrenches: 8 · Cloud connection (GCP)
  (increment_dc514c1a7edb), 17 · The library's commands (increment_6df7dd8a5e42) and 14 · Ranked search
  (increment_10ca9ddffa35).
- What was laid is counted in `stills/shots.json` under `layer`.

**Sample, clearly marked:** the box "Add sample work (made up, not in the library)" adds a second wrench, lavender and tagged
"sample", on 10 · Work in flight, with three made-up increments on two made-up arcs, so a wrench listing more than one arc
can be seen. Nothing else is sample.

## Stills

All taken by `tools/shots.mjs`, which clicks each mark where it stands on the page and checks the panel's heading.

| Still | What it shows |
| --- | --- |
| `resting.png` | The resting view: the whole graph |
| `whole-island.png` | Zoomed out to the whole island and its neighbours' roads |
| `close-up.png` | Data schema close up, picked (its outline lit) |
| `gaps.png` | Library API's gates close up, one from The command line picked, its road from the coast lit |
| `gate.png` | Owner questions' gate into Work in flight: Work in flight's contracts, the route lit |
| `road-arriving.png` | The road from the coast, from 7 stories, splitting to its 22 gates, every way lit |
| `road-off-the-coast.png` | The road to Keys |
| `pathway-contracts.png` | Rounds calls Lapsed questions, clicked on its road |
| `territory.png` | Work model's description and contracts |
| `wrench-arcs.png`, `sample-wrench-arcs.png` | The Cloud connection (GCP) wrench open; the sample wrench |
| `orbited.png`, `orbited-south-west.png` | Turned and tipped by the map's own keys, two ways |
| `real-today.png`, `side-by-side.png` | The map's island today, beside the mock |
| `round-5.png` | Round 5's resting view; `round-1.png` to `round-4.png` are round 2's look review, before and after each pass |

## Rebuild it

From the checkout root, after `pnpm install`:

```sh
node --import tsx docs/design/capability-tree-3d/a-stone/tools/measure.mjs   # data.json, from the library and the code
node docs/design/capability-tree-3d/a-stone/tools/build.mjs                  # index.html, page.js and page.css
node --import tsx docs/design/capability-tree-3d/a-stone/tools/shots.mjs --retake   # stills/
```

`tools/flow.ts` is the plan (layers, patches, gates and roads, no drawing); `tools/island.ts` lays it on the island and draws
it; `tools/page.tsx` mounts the map's own view; `tools/look.mjs` takes one quick still while drawing. `index.html?real` draws
the map's island as it is today, with nothing added; `?room=` and `?tilt=` change the island's extra land and the rest view's
tilt.

## What I would look at next (for Mick; nothing built from these)

1. **The trunk from the coast.** The 22 arriving links come in as one long diagonal road through the middle, because the
   map's lanes land in the south-east while most of what they call sits in the top layers. Either let them land on the
   north coast (the callers' side of a flowchart), or split the arrival by story so The command line's 14 have their own road.
2. **Library API's knot.** Six gates on one small patch (five from other stories) make the busiest corner; a patch's floor
   size could grow with its gate count.
3. **Long links.** Library API to Project libraries and Fixed data questions to The library's commands cross several layers;
   routing them along a shared corridor down one side, as a drawn flowchart does, may read cleaner than through the middle.
4. **Names over small patches.** A name wider than its patch covers it at rest; a small patch could carry its name beside it.
5. **The rest tilt.** Two steps nearer overhead keeps the far layers apart; whether the map's own opening tilt is better for
   a story close-up is worth a look side by side (`?tilt=0`).

## Earlier rounds (arc_9bbaa3497530; question_752b6ef53b90's context holds more)

| Round | What it tried | Mick's words | Where |
| --- | --- | --- | --- |
| 1 | Stone walls on every territory border, cobbled paths straight across | "looks very cramped, pathways look a mess" | PR #218 |
| 2 | Each capability a square walled field in columns by dependency, open commons between | "looks quite nice but ... every capability a square block" | PR #230 |
| 3 | The map's territories with castle walls on every border | "looks quite noisy, theres too much wall" | stopped |
| 4 | A walled town inset in each territory, roads in the strips between | "still looks vergy noisy. Lets not go with the walls" | PR #237 |
| 5 | No walls; the map's territories with dashed borders, solid roads along them, a gap per gate | "this needs a rethink, feels like the architecture diagram looked nicer ... on a flowcart theres plenty of space given to see the edges" | PR #240, `round-5.png` |

Round 6A answers round 5's lesson: a full tiling of territories leaves no room for the links, so this round keeps the
diagram's open space, layers and compact nodes, and keeps from the rounds before only what Mick liked: dashed outlines,
solid roads, a gap for each gate, the flat ink wrench, the map's island, colours and names.
