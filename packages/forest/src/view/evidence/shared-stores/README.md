# A project's shared store drawn beside its islands, with its tables inside, and its panel (contracts 4.46, 3.109, 3.110)

ADR-1332 D1, D2 (1): a shared store is drawn as its own object beside the islands, never nested in one, with its tables
inside it; its evidence and "who touches it: not yet read" are on its panel, never drawn as nodes.

The real desktop page on storytree's own map (the code-rows snapshot and its survey), its stores read by the map's own
`readStores` from a folder shaped like the checkbox interview repository (Postgres with pgvector in compose, five tables
from two .sql migrations). The checkbox repository itself sits on the Windows laptop, out of the box's reach on
2026-11-13. Taken by `packages/forest/testing/view/shared-stores/capture.mjs`.

Pictures, 1440 x 960:

- `store-beside-islands-1440x960.png`: the map's opening: the Postgres store `postgres://db/checkbox` as a blue slab
  west of the land, level with its middle, its five tables as pale tiles inside it, named.
- `store-panel-1440x960.png`: the store clicked: its panel names its medium and address, the three pieces of evidence
  naming it, "Who touches it: not yet read.", and its tables with their columns, types and foreign keys.

In the evidence bucket for #851, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `851/store-beside-islands-1440x960.png`, `851/store-panel-1440x960.png`.

## On the checkbox repository itself (increment_44871a60b43c)

The same page and the same reading, its stores read from the real checkbox repository on the laptop (`C:\code\checkbox`,
2026-11-13) with `capture.mjs --retake --folder C:\code\checkbox`; the islands are still the code-rows snapshot's.
`readStores` names one store, `postgres://db/ctx`, from `docker-compose.yml`'s service `db`, and the six tables of its
`0001_init.sql` (tenants, users, source_objects, chunks, grants, document_summaries) with every column, type and foreign
key, `source_objects` also carrying the self-referencing `parent_source_object_id` its `0003_summary_parent.sql` adds;
`0002_seed.sql` makes no table. Matching the fixture: no table missing and no wrong address. Its code's own default
connection string (`src/db.py`) is code, not a connection setting, so the panel's evidence names the compose file only.

- `store-beside-islands-1440x960-checkbox.png`: the store and its six tiles. The long names overrun their tiles
  (`document_summaries` under its neighbours, `source_objects` past its tile's edge): a fault of the drawing, not of the
  reading, parked as increment_049bcbe63687.
- `store-panel-1440x960-checkbox.png`: its panel: medium and address, the compose file naming it, "Who touches it: not
  yet read.", and the six tables with their columns, types and foreign keys.

In the evidence bucket for #852, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `852/store-beside-islands-1440x960-checkbox.png`, `852/store-panel-1440x960-checkbox.png`, `852/measurements-checkbox.json`.
