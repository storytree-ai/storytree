# Capability tree, medieval mock C: hedgerows and wooden gates

The story is one island cut into fields like an English patchwork. Thick, rounded hedgerows mark the borders, pale grassy tracks
carry the calls between capabilities, and a small wooden gate stands wherever a track goes through a hedge. Of the medieval
mocks, this one aims to be the gentlest and quietest: soft greens and creams, drawn flat from above, with nothing on it
that carries no meaning.

It is a mock, not the product (increment_b483f0add9eb, for question_752b6ef53b90 on arc_9bbaa3497530). It changes no
code and settles nothing until a direction is picked.

## Reopen it

Open `index.html` in any browser, straight from disk. It needs no network and carries its own copy of `data.json`.

- Click a **field** to see its description and contracts.
- Click a **track** or a **gate** to see what it carries: each called capability and its contracts.
- Click the **road off the coast** to see the other story's capability it reaches.
- Click the **wrench** to see every arc, with its increments, that wants that field.

From the checkout root:
- `node docs/design/capability-tree-medieval/c-hedgerow/tools/measure.mjs` measures again, rewriting `data.json` and the page's copy.
- `node docs/design/capability-tree-medieval/c-hedgerow/tools/shots.mjs` retakes the stills. Each one comes from a real click
  on the drawn mark, and the script fails if the page logs an error.

## Palette

| Meaning | Hex |
|---|---|
| Field, healthy | `#a8c77f` meadow |
| Field, not proven yet (untested or proposed) | `#ecd68b` straw |
| Field, unhealthy | `#dc8f7c` brick rose |
| Field, parked | `#aeb3ad` stone |
| Hedge (a border) | `#4f6a3a`, top `#6c8a4c` |
| Track (a call) | `#f2e8cb`, edge `#cdbb8d` |
| Gate | `#8b6a43` rails, `#5d4529` posts |
| Wrench (open work) | `#5a5f62` on a `#fbf6e8` disc |
| Sea, shallows, shore | `#d5e2d6`, `#e4ecdf`, `#ecdfba` |
| Panel, text | `#fbf7ec`, `#3d4733` |

The four field colours keep the map's four health meanings (packages/forest/src/view/territory-land.ts) apart at the
resting view: green, yellow and red differ in hue, and parked's stone grey is the only colour with no hue. The hedge is
much darker than any field so a border never reads as a field.

## What is measured, and what is not

All of it is measured. Nothing in the mock is a sample. The numbers were taken on 2026-11-02 from code at `22e957f`, and
are kept in `data.json`.

- **Fields:** The library's 24 capabilities (story_754e87e7d531), each with its own health as the tree reports it
  (`storytree tree`). 23 are healthy. 8 · Cloud connection (GCP) is untested, waiting on the owner.
- **Field area:** in proportion to the field's lines of code, not counting tests. Lines are counted the way the map's code
  survey counts them, as non-blank lines (packages/map/src/code-survey/code-survey.ts). The files come from each
  capability's `implements` edges in `storytree map --select cap:<id> --down 1 --kind file`. All 78 of the story's source
  files belong to a capability, so the map would draw no Unclaimed field. There are 14,566 lines in all.
  - Two fields would be too small to click: 25 · Lapsed questions (12 lines) and 9 · Knowledge entrances (38 lines). They
    are drawn at 0.4% of the island. Every other area is right to within 0.1%.
- **Tracks:** one for each `dependsOn` link between capabilities (28 links). A track runs from the field that calls to the
  field it calls, and goes through the fewest gates it can, so a few links pass through a field on the way. Tracks that
  share a stretch are drawn as one, and the stretch's popup lists each call on it. 15 · Connection by address also calls
  Keys' 1 · Key store and resolver, so a road leaves the coast labelled "to Keys".
- **Gates:** one wherever a track crosses a hedge. There is no hedge on the coast.
- **Wrench:** one open increment names one of these capabilities: increment_dc514c1a7edb, "Run the live Cloud SQL checks
  and record their health", on arc_238ac88fdb14. It puts the one wrench on field 8, at 8's main gate, the gate its call
  into 1 · Project libraries takes. A field would still get one wrench however many increments wanted it.
- **Layout:** a weighted Voronoi patchwork cut to the island. Linked fields are pulled together first, and the layout used
  (seed 3 of the 60 tried) is the one whose calls pass through the fewest fields on the way. The places mean nothing
  else.

## Stills

- `stills/resting.png`: the panel at rest.
- `stills/wrench-arcs.png`: the wrench's arc list open.
- `stills/gate-contracts.png`: the busiest gate open, with the contracts it carries.
- `stills/track-contracts.png`: one track open, with the contracts it carries.
- `stills/road-contracts.png`: the road to Keys open.
- `stills/territory.png`: a field open, with its description and contracts.
