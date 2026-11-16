# A project's shared store drawn beside its islands, with its tables inside, and its panel (contracts 4.46, 3.109, 3.110, 3.111)

ADR-1332 D1, ADR-1347 D3: a shared store is drawn as its own object beside the islands, never nested in one, with its
tables inside it. It is drawn only from the store links the mapping agent records on capabilities, never from compose
files, connection settings or migrations, so a project the agent has not mapped draws no store.

The real desktop page on storytree's own map (the code-rows snapshot and its survey), with store links to
`postgres://db/checkbox` put on two of its capabilities: the checkbox interview repository's seven tables, its two
longest names (`source_objects`, `document_summaries`) among them. Taken by
`packages/forest/testing/view/shared-stores/capture.mjs` (increment_9359decfd1eb, 2026-11-17).

Pictures, 1440 x 960:

- `store-beside-islands-1440x960.png`: the map's opening: the store as a blue slab west of the land, its seven linked
  tables as pale tiles inside it, named.
- `store-panel-1440x960.png`: the store clicked: its panel names its medium and address, then who touches it, judged by
  the mapping agent (each capability, its direction, its table and the file and line it cites), then its seven tables.
  It has no evidence section and no columns or foreign keys: links carry none (ADR-1347 D2).

`measurements.json` sets each tile's corners, projected into the window, beside its drawn name's box. At this opening
zoom `document_summaries`'s 136 px name overruns its 114 px tile (`whole: false`). That is a 4.46 tile-width fault in
the drawing, not in what is drawn, parked as increment_02be8887ffb5.

Earlier pictures of the same store read from compose and migrations (#851, #853, increment_44871a60b43c) went with
that reading.
