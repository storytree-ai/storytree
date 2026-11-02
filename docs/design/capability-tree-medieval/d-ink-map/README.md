# Capability tree, medieval mock D: an old hand-drawn map

The capability tree drawn as a storybook's endpaper map, in ink and wash on parchment: each capability of a story is a
washed territory on one island, parted from its neighbours by a crenellated ink wall, with roads drawn as fine double
ink lines and a small drawn arch for a gate wherever a road goes through a wall. Nothing is 3D, and nothing is drawn
that carries no meaning: no buildings, no people, no trees, no file dots.

A mock only, one of several asked for so a direction can be chosen (question_752b6ef53b90 on arc_9bbaa3497530). It
changes no product code.

## Open it

Open `index.html` from disk in any browser: one standalone page, no network, the measured data inside it. It is drawn
at the size of the capability tree beside the story panel on a 1440 × 900 screen, the panel on its right showing
what a click picks.

- Click a **territory**: its description, health, lines of code and contracts.
- Click a **road** or **its gate**: what it carries, the called capability's contracts (number and title).
- Click the **wrench**: every arc, with its increments, that wants that capability.
- Click the sea: back to the story.

## What is measured, and what is drawn

Everything on the map is real, measured on 2026-11-02 from storytree's own library (project `storytree`), story
"The library" (`story_754e87e7d531`), into `data.json`. **No sample is used.**

- **Territories and areas.** 24 capabilities. Each territory's area is in proportion to its lines of code excluding
  tests: the map's own measure (`TerritoryShare.lines`, the code survey's lines per capability from `packages/map`,
  summed as `packages/forest/src/render/forest-scene.ts` does). The two smallest (9 · Knowledge entrances, 38 lines;
  25 · Lapsed questions, 12 lines) are lifted to half a percent of the island so each can hold a gate and be clicked;
  every other territory is within 3% of its exact share (the capture script checks this).
- **Health.** The map's words, re-toned: all but one territory are healthy today; 8 · Cloud connection (GCP) is
  untested and parked, so it is washed parked's grey.
- **Roads.** One per link (`capability.dependsOn`), 27 inside the story. A road runs from the caller's name to the
  called one's, by the shortest way through the territories between, so it crosses a wall only at a gate; most go
  through one wall. One link leaves the story, 15 · Connection by address to Keys' 1 · Key store and resolver: a short
  road off the coast, lettered with its name.
- **The wrench.** One open increment names a capability of this story today: "Run the live Cloud SQL checks and
  record their health" (`increment_dc514c1a7edb`, arc "Cloud SQL sign-in, kept in the back pocket") on 8 · Cloud
  connection (GCP). No increment names which road it changes, so the wrench sits on that territory's main gate, the
  one on its road to Project libraries. Had more increments named it, there would still be one wrench, its list
  longer.
- **Where territories lie** is a design choice, not a measure: each territory's seed is placed by hand from the links
  (`PLACE` in the page) so a capability sits against the ones it calls; the areas are then fitted to their shares by a
  power diagram cut to the coast, which keeps every territory one connected piece.

## Palette

| Use | Hex |
| --- | --- |
| Parchment | `#efe3c4` |
| Ink (lines, lettering, walls, gates, wrench) | `#3a2b1c` |
| Faded ink (numbers, notes) | `#6b5a44` |
| Sea wash | `#c3cfc4` |
| Healthy wash, sap green | `#8fae6b` |
| Unhealthy wash, madder | `#c8553d` |
| Not proven yet wash (proposed, untested), ochre | `#dfb64a` |
| Parked wash, slate | `#8b98a1` |
| A picked mark, indigo ink | `#2e4a6e` |

The washes keep the map's four health meanings apart at the resting view: green, red and yellow by hue, parked by
being the one grey. The pick is indigo rather than the red ink old maps used, since red already means unhealthy.

## Remake it

From the checkout root:

1. `node --import tsx docs/design/capability-tree-medieval/d-ink-map/tools/measure.mjs` measures the story again into
   `data.json` (it reads the library this checkout names).
2. `node docs/design/capability-tree-medieval/d-ink-map/tools/inline.mjs` copies `data.json` into the page.
3. `node docs/design/capability-tree-medieval/d-ink-map/tools/shots.mjs` captures `stills/` by clicking the marks, and
   reports any page error and any territory off its share.

## Stills

- `stills/resting.jpg`: the map at rest.
- `stills/wrench-arcs.jpg`: the wrench clicked, its arcs listed.
- `stills/gate-contracts.jpg`: the gate on the road from 7 · Library API to 4 · Work model clicked, Work model's
  contracts listed.
- `stills/road-abroad-contracts.jpg`: the road off the coast clicked, Key store and resolver's contracts listed.
- `stills/territory-open.jpg`: 1 · Project libraries clicked, its description and contracts listed.
