# Capability tree, 3D mock 1, reworked: one roomy island, laid out by dependency, drawn as an inked map

The real map's 3D island for The library, as the desktop app draws it, with its land laid out again: each capability a
walled field in its health colour, the fields placed by what they call, open common ground between them, and the paths
running along the commons from gate to gate. The walls, gates, paths and wrench are drawn as an inked cartographer's map in
2.5D, in the manner of the map's claim flags: flat-drawn, upright, unlit. This is Mick's rework of mock 1 (increment_355de70ab9c4
on arc_9bbaa3497530, question_752b6ef53b90), after "looks very cramped, pathways look a mess". A mock only: it changes no
product code.

**Open it:** `index.html`, straight from disk; it needs no network. Drag to pan, right-drag (or Q/E and R/F) to turn and
tilt, wheel to zoom: the map's own controls. Click a field, a path, a gate, the road off the coast or a wrench, and the
panel on the right shows what it holds. The window is 1440 × 900 with the story panel's 352 pixels on the right, as the app
lays it out; the rest view frames the whole plan, every name and path in sight.

![Resting view](stills/resting.png)

## What changed from mock 1, and why

| Mick asked | What the mock does now |
| --- | --- |
| "looks very cramped": lay it out by dependency on one island, with empty space for the paths | Fields stand in columns by dependency depth, as the map lays its islands out in rows (`packages/forest/src/planet-places`): a capability that calls nothing in the west, each other one a column east of the deepest it calls. In a column the fields are sorted toward the fields they are linked to. Between every two columns, and between the fields of a column, runs a band of open commons. |
| Field area in proportion to lines of code, coloured by health | Each field is a square whose area is its lines (the five under 100 lines are drawn at 100, so each can hold its gate). The colours are the map's own, read from what it drew. |
| "pathways look a mess": route them like the story-node roads | The paths run only along the commons' centre lines, as the map's border routes run only along lines already drawn (`packages/forest/src/view/border-route.ts`). Each field has one gate; a path leaves by it, takes the shortest way along the lines and enters the other field by its gate. One path per linked pair, never one each way, and a stretch already walked is cheaper, so the ways merge. No path crosses a field. |
| Calmer walls, in a castle-wall look, 2.5D like the claim flags | Four straight runs of wall around each field and nothing else: an upright cut-out with a pale band, crenellations and a thin ink outline, low, unlit and untextured, standing on the land so it reads as the map turns. |
| Simpler gates | An opening in the wall between two small square towers, drawn the same way. |
| A wrench in the claim flags' style, told apart from a flag | A flat ink spanner standing upright on a small shadow, constant on screen like the flag; pale, with no pole and no pennant. The field's name hangs just below it, as a claimed territory's name hangs below its flag. |
| Room, not hiding | Nothing is hidden at rest. The island is given more land (1.6 times its lines' worth, the map's own island grown by its own rules), and the rest view is framed on the plan, its names included. |

**What the map still draws, unchanged:** the island's coast, cliffs and shape, the glass sheet, the other islands and the
roads between them, the selection ring, the camera and its controls (`PlanetView`, mounted as the desktop app mounts it).
**What the mock switches off on this island:** the map's own cut of it into territories (its fills, white borders and file
dots), since the fields replace it, and the selection's purple lanes, whose job the paths and the road off the coast take.

## What came from anatomy

[anatomy](https://github.com/wheresryan22/anatomy) (MIT) draws ideas as clean isometric diagrams. Nothing of its code or art
is copied; these principles are borrowed:

- **One thin ink weight.** Every outline is one pixel of the same ink (`#1b1814`) at any zoom, as anatomy's lines are one
  non-scaling weight; only the picked mark changes colour.
- **Few tones, one accent.** The marks use the ink, one pale wall tone, one path brown and the parchment commons; gold is
  the one accent, for the picked mark.
- **Every line ends on something.** A path begins and ends at a gate, the road ends at a dot, a wall run ends at a corner
  or a tower.
- **Depth from shape and order, not shading.** The walls and towers stand up as cut-outs; nothing is lit or hatched.
- **One recipe per symbol.** Every wall run, tower and wrench is built by one function at one scale.
- **No floating text on the drawing.** Names are the map's own nameplates, each on its field or just below it.

Where anatomy and Mick's direction part, Mick's wins: anatomy fills its figures with many small parts, and this mock keeps
the island minimal.

## What is measured, and what is sample

Every number is the real library and code on 2026-11-02 (`data.json`'s `measuredAt`), read by `tools/measure.mjs` from the
project's library and the code survey the map itself uses:

- The library (story_754e87e7d531): 24 capabilities, 14,581 lines in 78 files. 21 healthy, 2 untested (5 · Health record,
  17 · The library's commands) and one, 8 · Cloud connection (GCP), untested and parked, so grey.
- 28 links: 27 inside the story (27 paths, since no two capabilities call each other both ways) and the one to Keys.
- Open work: one open increment names one of these capabilities, increment_dc514c1a7edb on 8 · Cloud connection (GCP).
  That is the wrench at rest.
- What was laid is counted in `stills/shots.json` under `layer`.

**Sample, clearly marked:** the box "Add sample work (made up, not in the library)" adds a second wrench, lavender and
tagged "sample", on 10 · Work in flight, with three made-up increments on two made-up arcs. Nothing else is sample.

## Palette

| Meaning | Hex |
| --- | --- |
| Healthy, untested, parked fields (the map's) | `#97C459`, `#F2D16B`, `#86939D`, at the map's opacity |
| Commons (the land between the fields) | `#d9d1b9` |
| Ink: every outline, the road's end | `#1b1814` |
| Wall and tower faces | `#ece4d0` |
| Paths, dashed | `#6e5236` |
| Wrench | `#e6e9ec`, sample `#d6bdf0` |
| Picked mark (the selection's gold) | `#ffd34d` |

## Stills

All taken by `tools/shots.mjs`, which clicks each mark where it stands on the page and checks the panel's heading.

| Still | What it shows |
| --- | --- |
| `resting.png` | The resting view |
| `whole-island.png` | Panned out to the whole island |
| `close-up.png` | One field close up (Data schema, picked) |
| `wrench-arcs.png` | The Cloud connection wrench's arc list |
| `sample-wrench-arcs.png` | The sample wrench, listing two made-up arcs |
| `pathway-contracts.png` | Rounds calls Lapsed questions: Lapsed questions' contracts |
| `gate.png` | Work in flight's gate: its calls out, its callers in |
| `territory.png` | Work model's description and contracts |
| `road-off-the-coast.png` | The road to Keys: Key store and resolver's contracts |
| `orbited.png`, `orbited-south-west.png` | Turned and tipped by the map's own keys, two ways |
| `real-today.png`, `side-by-side.png` | The map's island today, beside the mock |

## Rebuild it

From the checkout root, after `pnpm install`:

```sh
node --import tsx docs/design/capability-tree-3d/a-stone/tools/measure.mjs   # data.json, from the library and the code
node docs/design/capability-tree-3d/a-stone/tools/build.mjs                  # index.html, page.js, page.css
node --import tsx docs/design/capability-tree-3d/a-stone/tools/shots.mjs --retake   # stills/
```

`tools/layout.ts` is the plan (fields, commons and ways, no drawing); `tools/castle.ts` lays it on the island and draws it;
`tools/look.mjs` takes one quick still while drawing. `index.html?real` draws the map's island as it is today, with nothing
added; `?room=` and `?ground=` change the island's extra land and the rest view's framing.

## The look review

(Rounds recorded below as they run.)
