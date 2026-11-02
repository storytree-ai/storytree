# Medieval mock A: drystone walls and arched stone gates

The capability tree of one story, The library, drawn as a single island of fields on a warm parchment ground: each capability is a field fenced by drystone walls, sized by its lines of code and coloured by its health. The links between capabilities are cobbled lanes, and where a lane crosses a wall it goes through an arched stone gateway with its wooden door swung open; a wrench on a gate marks open work.

This is one of several mocks answering Mick's voice brief of 2026-11-02 (increment_cf50004813cd, question_752b6ef53b90 on arc_9bbaa3497530). It is a mock only: no product code changed.

## To open it

Open `index.html` in a browser, straight from disk: it carries its own copy of `data.json` and needs no network. Click a field for its description and contracts, a lane or a gate for the contracts it carries, the wrench for the arcs that want that capability. Click the sea to clear. The two switches beside the panel show samples (below).

## What is measured, and what is sample

Measured on 2026-11-02 (`data.json`), by `tools/measure.mjs`:

- **Fields:** the story's 24 capabilities (`storytree tree story_754e87e7d531`). A field's share of the island is its capability's share of the story's 14,566 lines of code: the files `storytree map --select cap:<id> --kind file` assigns to it, tests left out, counted in non-blank lines as the map's own code survey counts them (`packages/map/src/code-survey/code-survey.ts`). On the page every field is within 0.1% of its share.
- **Health:** each capability's word from the tree. 23 are healthy. Cloud connection (GCP) is untested, but its one open increment sits on a parked arc, so it reads parked, grey, as the map draws it (ADR-0992).
- **Lanes:** the 27 links among these capabilities (each capability's `dependsOn`). 24 of them run through a single gate between neighbouring fields; three (6→3, 7→6, 26→21) cross one field in between, since 24 fields cannot all touch their partners. Where several links share a stretch of lane or a gate it is drawn once, and a click lists every link it carries. The one link to another story's capability (Connection by address → Keys: Key store and resolver) walks to the nearest coastal field and leaves the island as a short labelled road.
- **Wrench:** one open increment names one of these capabilities today: "Run the live Cloud SQL checks and record their health" (increment_dc514c1a7edb, on the parked arc "Cloud SQL sign-in, kept in the back pocket"), on Cloud connection. Its wrench sits on Cloud connection's main gate, the gate of its own link, because which gate the work changes is not recorded.

Sample, off by default, each switched on beside the panel and flagged "sample shown" in the panel's title when on:

- **Every health state:** recolours four fields (4 Work model and 22 Decision log unhealthy, 11 Waits and 14 Ranked search not proven yet), so all four meanings can be told apart side by side at the resting view.
- **More wrenches:** two more, on Data schema and Library transactions, the second carrying two arcs with three increments between them, to show one wrench standing for several. Their titles echo real increments, but those increments do not name these capabilities.

## Palette

| Use | Hex |
| --- | --- |
| Parchment ground (the sea) | `#F4EFE2` |
| Coast line | `#B9A884` |
| Healthy field | `#A9C07A` |
| Unhealthy field | `#C9694F` |
| Not proven yet (untested or proposed) | `#E6C66E` |
| Parked field | `#9EA6A8` |
| Drystone, three tones | `#BFB49A`, `#A99D82`, `#CEC4AB` |
| Stone edge | `#85785F` |
| Cobbles, and their setts | `#DCD0B6`, `#B4A586` |
| Gate door, and its edge | `#9C6C40`, `#6C4828` |
| Wrench (iron) | `#4B4A4E` |
| Ink | `#4A3F2E` |

Shadows are soft and only under the walls and gates.

## How the island is drawn

The island is one landmass; its fields are a weighted Voronoi (power) diagram of it, fitted until each field's area matches its share of the lines. The start positions come from a force layout that pulls linked capabilities together, from a fixed seed (104, the best of the first 120 at putting links side by side), so the island draws the same every time. Field names are written where they fit; small fields show their number, and hovering a field gives its name.

## The files

- `index.html`: the page, the panel at the story detail panel's width (480 px).
- `data.json`: the measured snapshot.
- `stills/`: `resting.png`; `wrench-arcs.png` (the wrench's arc list open); `gate-contracts.png` and `lane-contracts.png` (what a gate and a stretch of lane carry); `field-open.png` (a field's description and contracts); `sample-every-state-and-wrenches.png` (both samples on); `page.png` (the page with its notes).
- `tools/measure.mjs`: measures again and copies the data into the page (`--inline-only` just copies). `tools/shots.mjs`: captures the stills and prints how well the areas fit and which links cross a field. Both run from the checkout root and use the website package's browser driver:

      node docs/design/capability-tree-medieval/a-drystone/tools/measure.mjs
      node docs/design/capability-tree-medieval/a-drystone/tools/shots.mjs
