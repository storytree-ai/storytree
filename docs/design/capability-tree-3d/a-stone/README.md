# Capability tree, 3D mock 1, round 3: the map's own territories, walled on their borders

The real map's 3D island for The library, as the desktop app draws it. Each capability keeps the organic territory the map
cuts for it, sized by its lines of code, and a low castle wall runs along its real border. The territories are placed so
that linked capabilities lie side by side: a link between neighbours is a gate in their shared wall. Where two linked
capabilities cannot touch, the territories between them are pulled apart just enough to open a narrow corridor of open
ground, and the path runs down it from gate to gate. Everywhere else the territories touch, as the map's do, and the island
stays full. A mock only: it changes no product code. Round 3 of increment_ebb59b22216f on arc_9bbaa3497530, after Mick on
PR #230's square fields: "I was thinking the wall follows the capability territoriy and we dont shrink the territory down
into a square. If we need a no-mans land territory corridor for a shared pathway to travel through then we would just
create it by creating space between the territories".

**Open it:** `index.html`, straight from disk; it needs no network. Drag to pan, right-drag (or Q/E and R/F) to turn and
tilt, wheel to zoom: the map's own controls. Click a territory, a gate, a path, the road off the coast or a wrench, and the
panel on the right shows what it holds. The window is 1440 × 900 with the story panel's 352 pixels on the right, as the app
lays it out; the rest view frames the whole island.

![Resting view](stills/resting.png)

## What changed from round 2 (PR #230), and why

| Mick asked | What the mock does now |
| --- | --- |
| Keep the map's own territory shapes, no squares | The island is cut by the map's own code (`territories()` in `packages/forest/src/territories/territories.ts`): the same 122 cells on the same coast, and each capability the same number of cells as the map gives it, so its area follows its lines exactly as on the map. The map's own `territoryLand()` draws them, in its own colours. PR #230's square fields and its beige commons board are gone. |
| The wall runs along the territory's real border | One wall along each border between two territories, shared by both, where the map draws its white border line. The coast is left to the island's own cliff. Each wall is cut to the land by the map's own `insideOf()`. |
| Place linked capabilities side by side | Only which cell goes to whom changes. Each capability has a seed, a point on the island; every territory grows from its seed at once, taking the free cell nearest its seed (weighed by its size) until it holds its share. The seeds were moved toward what each capability calls (`dependsOn`), keeping a move when more linked capabilities ended up side by side, the shapes stayed compact and every share was met (`tools/territory-plan.ts`). 23 of the 27 links in the story are now between neighbours. |
| A link between neighbours is a gate in their shared wall | An opening between two small towers, on the longest stretch of wall the two share. No path is drawn for it: the gate is the link. Clicking it shows the called capability's contracts. |
| A corridor only where a path must pass | The 4 links whose ends cannot touch get a way along the borders between other territories. The territories either side of each border it walks are pulled back from it, leaving a narrow strip of open ground, and the dashed path runs down its middle, entering each end through a gate. It never crosses a territory. Ways that share a stretch share it, as the story roads merge (`packages/forest/src/view/border-route.ts` walks only lines already drawn; these walk only borders). |
| Keep the rest | The 2.5D inked walls and towered gates, dashed paths, the flat ink wrench, every name shown, the map's colours, pan and zoom, the road off the coast to Keys (now through its own short corridor to the coast) and every click. |

**What the map still draws, unchanged:** the island's coast, cliffs and shape, the glass sheet, the other islands and the
roads between them, the selection ring, the camera and its controls (`PlanetView`, mounted as the desktop app mounts it).
**What the mock switches off on this island:** the map's own cut of it (its territory fills and white borders), since the
mock draws the same cells with new owners, and the selection's purple lanes, whose job the gates, paths and road take.

## Seeds: what the real map would need

The map's `territories(shares, outline, cellCount)` takes no seeds. It shares its cells out by halving the list of
capabilities in order, so where a territory lands follows its place in that list, not what it calls. The mock does not edit
or copy that code: it imports `territories()` for the cells and each capability's share, and builds the seeding beside it
in `tools/territory-plan.ts`. For the real map to place linked capabilities side by side it would need:

1. `territories()` to take a seed per share (or a growth that starts from given cells), and grow the regions from them
   instead of halving; the cells, their count and each share stay as they are.
2. Something to choose the seeds from the links. The mock searches for them once, at length, in the page (where the road off
   the coast knows where Keys lies), and stores them in `data.json` (`tools/seed.mjs`), so the page grows the same cut at once.
3. For corridors, the drawing to pull territories back from a border a way runs along: the mock cuts each cell by a line
   parallel to that border, which keeps every cell convex, so the map's own fill and coast cut draw it unchanged.

Moving any of this into the map is Mick's later decision.

## What came from anatomy

[anatomy](https://github.com/wheresryan22/anatomy) (MIT) draws ideas as clean isometric diagrams. Nothing of its code or art
is copied; these principles are borrowed:

- **One thin ink weight.** Every outline is one pixel of the same ink (`#1b1814`) at any zoom, as anatomy's lines are one
  non-scaling weight; only the picked mark changes colour.
- **Few tones, one accent.** The marks use the ink, one pale wall tone, one path brown and the parchment commons; gold is
  the one accent, for the picked mark.
- **Every line ends on something.** A path begins and ends in a gate's opening, the road ends at a dot, a wall run ends at
  a corner, a tower or the coast.
- **Depth from shape and order, not shading.** The walls and towers stand up as cut-outs; nothing is lit or hatched.
- **One recipe per symbol.** Every wall run, tower and wrench is built by one function at one scale.
- **No floating text on the drawing.** Names are the map's own nameplates, each on its territory.

Where anatomy and Mick's direction part, Mick's wins: anatomy fills its figures with many small parts, and this mock keeps
the island minimal.

## What is measured, and what is sample

Every number is the real library and code on 2026-11-02 (`data.json`'s `measuredAt`), read by `tools/measure.mjs` from the
project's library and the code survey the map itself uses:

- The library (story_754e87e7d531): 24 capabilities, 14,581 lines in 78 files. 21 healthy, 2 untested (5 · Health record,
  17 · The library's commands) and one, 8 · Cloud connection (GCP), untested and parked, so grey.
- 28 links: 27 inside the story and the one to Keys. 23 are gates between neighbours, 4 run through corridors.
- Open work: one open increment names one of these capabilities, increment_dc514c1a7edb on 8 · Cloud connection (GCP).
  That is the wrench at rest.
- What was laid is counted in `stills/shots.json` under `layer`.

**Sample, clearly marked:** the box "Add sample work (made up, not in the library)" adds a second wrench, lavender and
tagged "sample", on 10 · Work in flight, with three made-up increments on two made-up arcs. Nothing else is sample.

## Palette

| Meaning | Hex |
| --- | --- |
| Healthy, untested, parked territories (the map's, drawn by its own code) | `#97C459`, `#F2D16B`, `#86939D`, at the map's opacity |
| Corridor ground (the open strip a way runs down) | `#d9d1b9` |
| Ink: every outline, the road's end | `#1b1814` |
| Wall and tower faces | `#ece4d0` |
| Paths, dashed | `#6e5236` |
| Wrench | `#1b1814` with a `#ece4d0` edge; sample `#d6bdf0` |
| Picked mark (the selection's gold) | `#ffd34d` |

## Stills

All taken by `tools/shots.mjs`, which clicks each mark where it stands on the page and checks the panel's heading.

| Still | What it shows |
| --- | --- |
| `resting.png` | The resting view |
| `whole-island.png` | Panned out to the whole island |
| `close-up.png` | Close up on the middle of the island, Knowledge entrances picked: walls, gates and two corridors |
| `gate.png` | A gate between neighbours: Rounds calls Lapsed questions, and Lapsed questions' contracts |
| `pathway-contracts.png` | A corridor's path: Ranked search calls Knowledge artifacts, and Knowledge artifacts' contracts |
| `wrench-arcs.png` | The Cloud connection wrench's arc list |
| `sample-wrench-arcs.png` | The sample wrench, listing two made-up arcs |
| `territory.png` | Work model's description and contracts |
| `road-off-the-coast.png` | The road to Keys: Key store and resolver's contracts |
| `orbited.png`, `orbited-south-west.png` | Turned and tipped by the map's own keys, two ways |
| `real-today.png`, `side-by-side.png` | The map's island today, beside the mock |

## Rebuild it

From the checkout root, after `pnpm install`:

```sh
node --import tsx docs/design/capability-tree-3d/a-stone/tools/measure.mjs   # data.json, from the library and the code
node docs/design/capability-tree-3d/a-stone/tools/build.mjs                  # index.html, page.js, page.css
node --import tsx docs/design/capability-tree-3d/a-stone/tools/seed.mjs      # data.json's seeds, by a long search (then build again)
node --import tsx docs/design/capability-tree-3d/a-stone/tools/shots.mjs --retake   # stills/
```

`tools/territory-plan.ts` is the plan (who owns each cell, corridors, gates and ways; no drawing); `tools/castle.ts` lays it
on the island and draws it; `tools/look.mjs` takes one quick still while drawing. `index.html?real` draws the map's island as
it is today, with nothing added; `index.html?seed` searches for the seeds again instead of growing the stored ones.

## The look review

Mick's rule: "the adversarial review should just judge if the existing stuff looks nice, not add stuff it thinks is missing
without my go ahead." Each round a fresh reviewer is given only the stills, the page and the brief's review section, never
this session's reasoning or an earlier round's answers. It judges only what is drawn, against the 2.5D cartographer's-map
style, and flags anything that reads as a building, plot or game prop; anything it thinks missing goes under "for Mick" and
nothing is built from it. Findings about the map's own drawing, which the brief keeps unchanged underneath, are rejected with
that reason. Round 2's five review rounds, on the square fields, are in this folder's history (PR #230).

