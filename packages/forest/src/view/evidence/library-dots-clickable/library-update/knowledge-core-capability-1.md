# The knowledge core — capability 1

Apply these **field-level old → new** operations to the existing library records. Record IDs
below come from the read-only 2026-09-27T13-04-06-091Z snapshot. Read current live values
first and preserve later edits, sibling fields, links and shelf entries. Paths in the patch are
logical record targets, not repository files.

## REPLACE: Opening description

Target: **The knowledge core, capability 1**, `capability_c72570081c61`, field `description`.

Old:

```text
The project's artifacts hang below the stories' and capabilities' front covers, with depth counting the longest chain of references from any shelf. A shared artifact appears once, a loop is drawn as a labelled error, and an artifact no shelf reaches has "no depth". On the globe, shelf-placed artifacts are faint points beneath their islands, and no-shelf artifacts pool at the centre (ADR-0658). Forest shows this core beneath the story nodes; Library shows it alone on the same globe (ADR-0660 D4). The separate Look-inside view stays unmounted.
```

New:

```text
The project's artifacts hang below the stories' and capabilities' front covers, with depth counting the longest chain of references from any shelf. A shared artifact appears once, a loop is drawn as a labelled error, and an artifact no shelf reaches has "no depth". On the globe, shelf-placed knowledge is drawn beneath its islands. Story-text definitions are excluded from the drawing; the remaining no-shelf artifacts fill a ball within 0.55 globe radii, separated from one another and shelf points by at least 0.035 radii (ADR-0661 D3). Forest shows the core beneath the story nodes; Library shows it alone on the same globe (ADR-0660 D4). The separate Look-inside view stays unmounted.
```

## REPLACE: Faint-points book: replace the old centre-pool clause

Target: **The knowledge core, capability 1**, `definition_8968f73bc6fe`, field `meaning`.

Old:

```text
  - **Faint points on the globe (ADR-0658):** [the knowledge-under-islands book](../decisions/knowledge-under-islands.md).
    Each placement is a point under its island; no-shelf artifacts pool at the centre. No threads,
    ghosts or reads are drawn. Forest keeps its surface and failure attention; Library is the
    viewer's explicit choice to hide the story nodes and see this core alone (ADR-0660 D4).
```

New:

```text
  - **Faint points on the globe (ADR-0658, narrowed by ADR-0661 D3):** shelf knowledge remains
    beneath its islands. Story-text definitions are not drawn, and remaining no-shelf artifacts
    spread through a filled ball inside the shell. No threads, ghosts or reads are drawn.
    Forest keeps its surface and failure attention; Library is the viewer's explicit choice
    to hide story nodes and see this core alone (ADR-0660 D4).
```

## REPLACE: As-built rule and measured-spacing contract

Target: **The knowledge core, capability 1**, `definition_791c8168be87`, field `meaning`.

Old:

```text
- **As built:** `underShelves(changes, knowledge)` in `packages/knowledge-core`, a pure function of
  the library's `changesSince(0)` and capability 2's `knowledge`. Each live story and capability is
  a shelf on its story's island, oldest first, holding its active front covers, oldest first; an
  empty one says "no knowledge on this shelf yet". Links are followed between active artifacts only.
  Artifacts that all lead back to one another (Tarjan's strongly connected groups), or an artifact linking
  to itself, form one loop with one depth and the label "loop: a refused shape"; depth is the
  longest chain over the groups. Each placed artifact carries its depth, home, entrances (oldest
  first) and loop; the rest are in the `outside` collection, by id, meaning no shelf route.
  `globePoints(core, spots, radius)` reuses the shelf directions and longest-depth spacing,
  placing the no-shelf collection in a small centre cluster at 0.04 radii. The forest mounts
  `KnowledgeGlobePoints` from `@storytree/knowledge-core/view` in its turning globe: faint,
  fixed-size points with no raycast or depth writing, fed by the existing core's live history
  subscription. The core's public `take`/`dispose` API is unchanged. No ghosts, reads or threads
  enter this drawing. [Seeded evidence](../packages/forest/src/view/evidence/knowledge-under-islands/README.md)
  records the census, renderer and unchanged forest interactions.
  **Forest / Library (ADR-0660 D4), as built:** the forest's toggle leaves this point layer
  mounted in both modes with the same live subscription, positions and depths. Library shows
  only these faint shelf points and the no-shelf centre cluster. It adds no threads, ghosts,
  read colours or inspection controls. Evidence is in
  `packages/forest/src/view/evidence/forest-library-toggle/README.md`.
```

New:

```text
- **As built:** `underShelves(changes, knowledge)` in `packages/knowledge-core`, a pure function of
  the library's `changesSince(0)` and capability 2's `knowledge`. Each live story and capability is
  a shelf on its story's island, oldest first, holding its active front covers, oldest first; an
  empty one says "no knowledge on this shelf yet". Links are followed between active artifacts only.
  Artifacts that all lead back to one another (Tarjan's strongly connected groups), or an artifact linking
  to itself, form one loop with one depth and the label "loop: a refused shape"; depth is the
  longest chain over the groups. Each placed artifact carries its depth, home, entrances (oldest
  first) and loop; the rest are in the `outside` collection, by id, meaning no shelf route.
  `globePoints(core, spots, radius, knowledge.notes)` reuses the shelf directions and
  longest-depth spacing. One named, exported and tested rule, `isStoryText(record)`, returns
  true only for a `definition` whose `term` or `title` starts with `Story text: stories/`.
  These records remain in the library and knowledge model but contribute no drawn points,
  whether shelf-placed or loose. An ordinary definition, principle or decision stays eligible.
  Remaining no-shelf IDs, sorted for deterministic placement, occupy a shuffled cubic lattice
  filling a ball of radius at most 0.55R. Grid spacing starts at 0.7R / cube-root(count),
  refining only if too few cells remain; it never falls below 0.035R. Cells within 0.035R
  of any drawn shelf point are rejected. Thus loose-dot centres are separated by at least
  0.035R from one another and shelf dots, more than the 0.012R drawn dot diameter; the
  entire dot stays inside the radius-R shell. They gain no shelf or invented depth.
  The finite lattice reports a capacity error if no more positions can meet that margin.
  The forest mounts `KnowledgeGlobePoints` from `@storytree/knowledge-core/view`, fed by
  the existing live history subscription. Mesh raycasting and depth writing remain off;
  the screen-space picker makes dots clickable in both modes (ADR-0661 D1).
  **Forest / Library (ADR-0660 D4), as built:** both modes submit the same filtered points
  at the same positions and depths, with the same separated loose artifacts. Hiding the
  surface leaves the core mounted. No threads, ghosts or read colours enter this drawing.
  The globe's summary card is capability 4's existing card, mounted by ADR-0661 D2.
  Counts, exclusion census, minimum distances and renderer evidence are in
  `packages/forest/src/view/evidence/library-dots-clickable/README.md`.
```

## REPLACE: Contract 1.5: exclude story text even when shelf-placed

Target: **The knowledge core, capability 1**, `contract_f48e62f638ec`, field `title`.

Old:

```text
1.5 · The globe draws every shelf-placed artifact once beneath its home island at its computed longest-chain depth. Ghosts, proposals and retired artifacts add no points.
```

New:

```text
1.5 · The globe draws every shelf-placed artifact once beneath its home island at its computed longest-chain depth. Ghosts, proposals, retired artifacts and story-text definitions add no points.
```

## REPLACE: Contract 1.6: replace the 0.04R centre cluster

Target: **The knowledge core, capability 1**, `contract_506c58267cb2`, field `title`.

Old:

```text
1.6 · No-shelf artifacts form a small, distinct, stable cluster at the centre, wholly inside the shell. They gain no depth or invented shelf, and an empty corpus draws no points.
```

New:

```text
1.6 · No-shelf artifacts that are not story text fill a deterministic ball within 0.55 globe radii. Their centres remain at least 0.035 radii apart and at least that far from drawn shelf points, above the 0.012-radii dot diameter; every dot is wholly inside the shell. They gain no depth or invented shelf, and an empty corpus draws no points.
```

## REPLACE: Contract 1.7: preserve filtered mode parity

Target: **The knowledge core, capability 1**, `contract_55ed4e7c7ae9`, field `title`.

Old:

```text
1.7 · Forest and Library submit the same complete set of artifact points at the same positions and computed depths, with the same no-shelf centre cluster; hiding story nodes leaves the live core mounted.
```

New:

```text
1.7 · Forest and Library submit the same complete set of eligible artifact points at the same positions and computed depths, with the same separated no-shelf artifacts; hiding story nodes leaves the live core mounted.
```

## ADD: ADD contract 1.8, or the next free number

Target: **The knowledge core, capability 1**, `new-contract-1.8`, field `title`.

Old: no corresponding contract in the snapshot. Add it under this capability; use the
next free number if the proposed number was taken later.

New:

```text
1.8 · isStoryText(record) is true only for a definition whose term or title starts with "Story text: stories/". Those records are excluded from the globe points whether loose or shelf-placed, while ordinary definitions, principles and decisions remain eligible and no library record is removed.
```
