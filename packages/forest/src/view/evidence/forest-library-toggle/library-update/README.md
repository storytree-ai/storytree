# Library update for the laptop supervisor

Pending application after merge. These are proposed edits to existing library records, not a
second library or importable source files. ADR-0660 D4 already exists; create no decision record.

The [patch](changes.patch) shows exact **old → new** text against #120's committed read-only
story snapshots. Its paths name logical targets, not repository paths. The owner's live text
may have subsequent edits: read each current field, apply only these blocks, preserve sibling
text, record IDs, links and shelves, then read back. Do not replace a whole live field from
these snapshots. Completed target text is included to make the additions reviewable.

- [ ] **Forest story, capability 3, Story node render:** REPLACE its opening description,
  the never-hidden book paragraph, stale “no view switch” / “without a Forest choice” clauses,
  the points' always-visible surface clause, and contract 3.1 using the patch. In particular,
  the never-hidden rule binds Forest; Library is the viewer's explicit choice to hide all
  story nodes, including failing islands and markers (ADR-0660 D4).
- [ ] **Forest story, capability 3:** ADD the “Forest / Library, as built” paragraph and
  contracts 3.9–3.11 (use the next free numbers if later edits already allocated them).
  See [target text](forest-capability-3.md). Keep contracts 3.2–3.8 and all unrelated books.
- [ ] **Knowledge core story, capability 1, Knowledge under its shelves:** REPLACE the
  description's page-mode clause and the faint-points book's always-available surface clause;
  ADD the Forest / Library as-built paragraph and contract 1.7. Library shows the existing
  core alone, with unchanged positions, depths, centre cluster and live subscription.
  See [target text](knowledge-core-capability-1.md).
- [ ] Read the live records back. Confirm both stories describe Forest as the launch default,
  Library as core-only, and the never-hidden exception as the owner's explicit mode choice.
  Confirm existing record IDs, shelf entries and sibling text survived.

The snapshot used for rendering is read-only input from
`~/storytree-lanes/snapshots/2026-09-27T11-59-47-107Z.json`, restored only to a throwaway home.
It does not authorize writing back to the snapshot or the owner's running app library.
