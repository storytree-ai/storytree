# Library update for the laptop supervisor

Pending application after merge. These are edits to existing library records and additions
to their contracts. They are a reviewable patch and checklist, not a second library or
importable story source. ADR-0661 already exists in the 0.2 store; create no decision record.

[changes.patch](changes.patch) gives exact **old → new** field text from the owner's newest
read-only snapshot, `2026-09-27T13-04-06-091Z.json`. Its paths name logical story, capability,
record and field targets. Do not create `stories/` or `decisions/` folders or apply this patch
to the repository as source files. The record IDs are lookup aids; the owner's running app
library remains the edit surface. Read each live field first, preserve subsequent edits and
unrelated fields, then read it back after application.

- [ ] **The forest, capability 3 — Story node render**
  (`capability_8ffc78a4bad2`): REPLACE the description, obsolete centre-pool and
  “intercepts no clicks” prose, and contracts 3.3 and 3.9. ADD contracts 3.12 and 3.13,
  using the next free numbers if required. The [field operations](forest-capability-3.md)
  cover picking in both modes, title tooltip and cursor, an 8 CSS-pixel hit radius,
  rejection after a drag of 5 pixels or more, and the artifact card in the story panel's
  right-hand slot. Forest admits the near half through the transparent shell; the shell
  blocks far-side dots and land in front wins. Library allows every projected on-screen
  drawn dot to be picked. Story and card replace one another; Close and Escape dismiss
  the card. Preserve the existing island and failure-attention behaviour.
- [ ] **The knowledge core, capability 1 — Knowledge under its shelves**
  (`capability_c72570081c61`): REPLACE the description, faint-points book, as-built
  placement paragraphs and contracts 1.5–1.7; ADD contract 1.8, using the next free number
  if required. The [field operations](knowledge-core-capability-1.md) name the one rule:
  `isStoryText(record)` matches only a `definition` whose `term` or `title` starts with
  `Story text: stories/`. Exclude these from drawn points whether loose or shelf-placed;
  leave the records in the library. Replace the old 0.04R centre cluster with the
  deterministic filled ball within **0.55R**, with loose-dot centre spacing and clearance
  from shelf dots of at least **0.035R**, above the **0.012R** dot diameter. Both modes
  keep the same filtered positions and live core. The snapshot census and measured
  distances belong with the [landing evidence](../README.md), not the historical seed.
- [ ] **The knowledge core, capability 4 — Look inside and inspect an artifact**
  (`capability_062b84e5c6b0`): REPLACE the description, blanket “unmounted” statements,
  card and stale-link prose, renderer-mount paragraph and contract 4.1; ADD contract 4.6,
  using the next free number if required. The [field operations](knowledge-core-capability-4.md)
  mount the existing pin, shared card model and one summary renderer on the globe in both
  modes. The card shows kind, title and description or another summary field; it shows
  the whole text when no summary exists. It displays no links list, read counts, depth
  or entrances. Opening a story and opening a card are mutually exclusive; Close and
  Escape dismiss the card. The separate inspection and replay surface stays unmounted.
- [ ] Read back every changed field and new contract. Confirm all three capabilities agree
  about the shared right-hand slot, story-text exclusion, loose spread and mode behaviour.
  Preserve existing IDs, links, shelves, unrelated books and historical evidence. Record
  that this pending library-text handoff was applied by the laptop supervisor.

This lane neither writes to the snapshot nor reaches the owner's running app library.
