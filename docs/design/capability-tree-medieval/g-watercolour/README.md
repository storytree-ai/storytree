# Medieval mock G: storybook watercolour

The capability tree of one story, The library, painted like an illustrated children's book map: each capability is a territory in a soft watercolour wash on textured paper, sized by its lines of code and tinted by its health, with the pigment pooling a little darker at its edge. Red-brown brick walls with a pale coping run along every border, sandy paths are the links between capabilities, and where a path meets a wall it passes through a pair of timber gates hung on brick piers; a wrench on a gate marks open work.

This is one of several mocks answering Mick's voice brief of 2026-11-02 (increment_f341b232c62e, question_752b6ef53b90 on arc_9bbaa3497530). It is a mock only: no product code changed.

## To open it

Open `index.html` in a browser, straight from disk: it carries its own copy of `data.json` and needs no network. Click a territory for its description and contracts, a path or a gate for the contracts it carries, a wrench for the arcs that want that capability. Click outside the island to clear. The two switches beside the panel show samples (below).

## What is measured, and what is sample

Measured on 2026-11-02 (`data.json`), by `tools/measure.mjs`:

- **Territories:** the story's 24 capabilities (`storytree tree story_754e87e7d531`). A territory's share of the island is its capability's share of the story's 14,566 lines of code: the files `storytree map --select cap:<id> --kind file` assigns to it, tests left out, counted in non-blank lines as the map's own code survey counts them (`packages/map/src/code-survey/code-survey.ts`). On the page every territory is within 0.1% of its share.
- **Health:** each capability's word from the tree. 22 are healthy and Health record is untested (ochre, "not proven yet"). Cloud connection (GCP) is untested too, but its one open increment sits on a parked arc, so it reads parked, grey-lavender, as the map draws it (ADR-0992).
- **Paths:** the 27 links among these capabilities (each capability's `dependsOn`). 24 of them run through a single gate between neighbouring territories; three (6→3, 7→6, 26→21) cross one territory in between, since 24 territories cannot all touch their partners. Where several links share a stretch of path or a gate it is drawn once, and a click lists every link it carries. The one link to another story's capability (Connection by address → Keys: Key store and resolver) walks to the nearest coastal territory and leaves the island as a short labelled road.
- **Wrenches:** three open increments name three of these capabilities today, so the three wrenches are real, one per territory, each on its territory's main gate (the gate of its own first link), because which gate the work changes is not recorded:
  - Cloud connection: "Run the live Cloud SQL checks and record their health" (increment_dc514c1a7edb, on the parked arc "Cloud SQL sign-in, kept in the back pocket");
  - The library's commands: "Find the open increments that name a capability" (increment_67d6f787a27d, on this arc);
  - Health record: "A failing health reading keeps the failure's first message" (increment_8c62a94c7280, on "A failing health reading names its failure").

Sample, off by default, each switched on beside the panel and flagged "sample shown" in the panel's title when on:

- **Every health state:** recolours four territories (4 Work model and 22 Decision log unhealthy, 11 Waits and 14 Ranked search not proven yet), so all four meanings can be told apart side by side at the resting view.
- **More wrenches:** two more, on Data schema and Library transactions, the second carrying two arcs with three increments between them, to show one wrench standing for several. Their titles echo real increments, but those increments do not name these capabilities.

## Palette

| Use | Hex |
| --- | --- |
| Paper (the panel and the ground) | `#F7F1E3` |
| Sea wash, and the coast line | `#BCD3D6`, `#8FAFB3` |
| Healthy wash, and its pooled edge | `#9CBF7C`, `#6E9A55` |
| Unhealthy wash, and its edge | `#E3907A`, `#C2654F` |
| Not proven yet (untested or proposed), and its edge | `#EBC66C`, `#C99A3A` |
| Parked wash, and its edge | `#AFAEC0`, `#85839C` |
| Brick, three tones | `#A8593E`, `#94472F`, `#B86A4C` |
| Mortar, and the coping | `#E6D6BA`, `#D9C7A4` |
| Sandy path, and its verge | `#EAD5A4`, `#CDAE72` |
| Timber gate, and its edge | `#9A6A3E`, `#5E3C1F` |
| Wrench (iron) | `#4E4A4F` |
| Ink | `#4A3B2C` |

The unhealthy wash is a pale rose so that it is never read as the brick of the walls. The paint effects are SVG filters: each wash's edge wanders a little and its pigment settles unevenly, the walls and paths wobble slightly as if drawn by hand, and a fine paper grain lies over the whole sheet. Shadows are soft and only under the walls and gates.

## How the island is drawn

The island and its territories are laid out exactly as in mock A (`../a-drystone`), so the two compare one for one: one landmass whose territories are a weighted Voronoi (power) diagram of it, fitted until each territory's area matches its share of the lines, its start positions from a force layout that pulls linked capabilities together, from a fixed seed (104), so the island draws the same every time. Only the painting differs. Territory names are written where they fit; small territories show their number, and hovering one gives its name.

## The files

- `index.html`: the page, the panel at the story detail panel's width (480 px).
- `data.json`: the measured snapshot.
- `stills/`: `resting.png`; `wrench-arcs.png` (a wrench's arc list open); `gate-contracts.png` and `path-contracts.png` (what a gate and a stretch of path carry); `territory-open.png` (a territory's description and contracts); `sample-every-state-and-wrenches.png` (both samples on); `page.png` (the page with its notes).
- `tools/measure.mjs`: measures again and copies the data into the page (`--inline-only` just copies). `tools/shots.mjs`: captures the stills and prints how well the areas fit and which links cross a territory. Both run from the checkout root and use the website package's browser driver:

      node docs/design/capability-tree-medieval/g-watercolour/tools/measure.mjs
      node docs/design/capability-tree-medieval/g-watercolour/tools/shots.mjs
