# Medieval mock F: pixel art

The capability tree of one story, The library, drawn as a small pixel-art island at 240 × 176 and scaled up ×2 nearest-neighbour: each capability is a grass territory ringed by sandstone walls, sized by its lines of code and coloured by its health. The links between capabilities are square dirt roads, a stone-posted gate with a plank door wherever a road passes a wall, and a wrench on a gate marks open work.

This is one of several mocks answering Mick's voice brief of 2026-11-02 (increment_4caf7aae8231, question_752b6ef53b90 on arc_9bbaa3497530). It is a mock only: no product code changed.

## To open it

Open `index.html` in a browser, straight from disk: it carries its own copy of `data.json` and needs no network. Click a territory for its description and contracts, a road or a gate for the contracts it carries (the called capability's), a wrench for every arc, with its increments, that wants that capability. Hovering names what is under the pointer. Click the sea to clear. The switch under the panel shows a sample (below).

## What is measured, and what is sample

Measured on 2026-11-02 (`data.json`), by `tools/measure.mjs` (the same measure as mock A's, pointed at this folder):

- **Territories:** the story's 24 capabilities (`storytree tree story_754e87e7d531`). A territory's share of the island is its capability's share of the story's 14,566 lines of code: the files `storytree map --select cap:<id> --kind file` assigns to it, tests left out, counted in non-blank lines as the map's own code survey counts them (`packages/map/src/code-survey/code-survey.ts`). On the page every territory is within 1.2% of its share (counted in pixels, walls included). Territories too small for their number (9 Knowledge entrances, 25 Lapsed questions) are named on hover.
- **Health:** each capability's word from the tree. 23 are healthy; Cloud connection (GCP) is untested, but its one open increment sits on a parked arc, so it reads parked, grey, as the map draws it (ADR-0992).
- **Roads:** the 27 links among these capabilities (each capability's `dependsOn`). 19 run through one gate between neighbouring territories; 8 cross one or two territories in between (2→1, 6→3, 7→1, 7→5, 7→6, 26→21, 26→25, 10→4), since 24 territories cannot all touch their partners. Where several links share a stretch of road or a gate it is drawn once, and a click lists every link it carries. The one link to another story's capability (15 Connection by address → Keys: Key store and resolver) leaves the coast as a short road onto the sea, labelled.
- **Wrenches:** two open increments name these capabilities today. "Run the live Cloud SQL checks and record their health" (increment_dc514c1a7edb, parked arc "Cloud SQL sign-in, kept in the back pocket") on 8 Cloud connection, and "A failing health reading keeps the failure's first message" (increment_8c62a94c7280, arc "A failing health reading names its failure") on 5 Health record. Each wrench sits on its territory's main gate (the first gate on its own road to what it calls), because which gate the work changes is not recorded.

Sample, off by default, switched on under the panel and flagged "sample shown" in the panel's title when on: 4 Work model reads unhealthy and 10 Work in flight not proven yet, so all four health colours sit side by side at the resting view; and a wrench on 1 Project libraries (and one on 2 Library transactions) carrying two sample arcs with three sample increments between them, to show one wrench standing for several. Their titles start "Sample".

## Palette

| Use | Hex |
| --- | --- |
| Sea | `#2F5D7C` |
| Shore (one pixel of shallows) | `#3F7596` |
| Healthy | `#79A845` |
| Unhealthy | `#C75B3F` |
| Not proven yet (untested or proposed) | `#E3BB4F` |
| Parked | `#8F9396` |
| Wall: top, body, foot and joints | `#DDD1B6`, `#B9A888`, `#7D6B50` |
| Road, and a selected road | `#B08550`, `#F0D79A` |
| Gate door, and its planks | `#8B5A2B`, `#5E3A1A` |
| Wrench steel, shade | `#D8DDE2`, `#8C949C` |
| Outline | `#1D1B22` |
| Ink, and the paper behind numbers | `#2B2118`, `#F4E9CF` |

The only shading is a one-pixel shadow under each wall. A selected territory's walls light up (its ground keeps its health colour); a selected road or gate lights the roads it carries.

## How the island is drawn

The island is one landmass of fixed shape; its territories are a weighted Voronoi (power) diagram on the pixel grid, fitted until each territory's pixel count matches its share of the lines, then trimmed pixel by pixel without cutting any territory in two. The sites start from a force layout that pulls linked capabilities together, from a fixed seed (12, the best of the first 200 at putting links between neighbours: `tools/shots.mjs --seeds 200`), so the island draws the same every time. A wall is every pixel touching another territory; each pair of neighbours gets one gate on the middle of the straightest stretch of their shared wall. Roads run square, along then across, from a territory's centre (its pixel furthest from any wall) to its gates. Numbers are drawn in a 3 × 5 pixel font.

## The files

- `index.html`: the page, the panel at the story detail panel's width (480 px).
- `data.json`: the measured snapshot.
- `stills/`: `resting.png`; `wrench-arcs.png` (a wrench's arc list open); `gate-contracts.png` and `road-contracts.png` (what a gate and a road carry); `territory-open.png` (a territory's description and contracts); `sample-every-state-and-wrench-arcs.png` (the sample on); `page.png` (the page with its notes).
- `tools/measure.mjs`: measures again and copies the data into the page (`--inline-only` just copies). `tools/shots.mjs`: captures the stills and prints how well the areas fit and which links cross a territory. Both run from the checkout root and use the website package's browser driver:

      node docs/design/capability-tree-medieval/f-pixel/tools/measure.mjs
      node docs/design/capability-tree-medieval/f-pixel/tools/shots.mjs
