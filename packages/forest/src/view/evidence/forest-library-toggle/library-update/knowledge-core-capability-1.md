The project's artifacts hang below the stories' and capabilities' front covers, with depth counting the
longest chain of references from any shelf. A shared artifact appears once, a loop is drawn as a
labelled error, and an artifact no shelf reaches has "no depth". On the globe, shelf-placed
artifacts are faint points beneath their islands, and no-shelf artifacts pool at the centre
(ADR-0658). Forest shows this core beneath the story nodes; Library shows it alone on the
same globe (ADR-0660 D4). The separate Look-inside view stays unmounted.

- **Depends on:** 2, for which artifacts are ghosts. It reads the library's `projectTree` and its
  change history (`changesSince`), and places entrances at the forest's island places.
- **Its shelf,** founding book first:
  - **Founding book (D1, approved with ADR-0647):** a chain follows stored references in their
    direction. The shelf-to-cover step counts as 1, and each later link adds 1. An artifact's depth is
    the longest chain from any shelf, never the shortest route or its popularity (ADR-0476 D2).
    Visits and incoming-link counts never change it (ADR-0476 D4). An artifact reached by two shelves
    appears once, at its greatest depth, and names both entrances. A front cover keeps its own
    shelf as its home; another shared artifact hangs under the oldest reachable shelf, ties broken by
    id. Ghosts and proposed decisions are left out of depth.
  - **Loops (L3, ADR-0647 D2):** the graph is a DAG, and the library refuses a loop-closing link
    (storytree-ai/storytree#87). For a loop stored before that, a group of artifacts that all lead back to one another is drawn as one knot,
    labelled as a refused shape, at one group depth; artifacts beyond it still get their longest-chain
    depth. An unreachable loop, like any unreachable artifact, has no depth.
  - **Faint points on the globe (ADR-0658):** [the knowledge-under-islands book](../decisions/knowledge-under-islands.md).
    Each placement is a point under its island; no-shelf artifacts pool at the centre. No threads,
    ghosts or reads are drawn. Forest keeps its surface and failure attention; Library is the
    viewer's explicit choice to hide the story nodes and see this core alone (ADR-0660 D4).
  - **No shelf means only "no recorded route from a shelf"**, never "unimportant": several
    whole-project decisions sit on no shelf (ADR-0631).
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
- **Historical placement seed** (this repo's stories and decisions synced into a scratch project on
  2026-09-27, with this story added): 74 artifacts and 65 shelves, all with a cover; 69 artifacts at depth
  1; the five outside are the planet, licence, testing-rule, MVP-spec and verified-health
  decisions, as the review measured; no loops and no ghosts.

**Contracts:**
1. With a cover A, links A → B → C and a shortcut A → C, C stays at depth 3: the shelf-to-cover
   step counts as 1. Visits and incoming-link counts never change that depth.
2. An artifact reached by two shelves appears once, at its greatest depth, and names both entrances. A
   front cover keeps its own shelf as its home, and another shared artifact hangs under the oldest
   reachable shelf, with a stable tie-break.
3. With A → B → C → B and C → D, B and C share a loop marked as an error at group depth 2, and D is
   at 3. An unreachable loop, like any unreachable artifact, is classified as no shelf, with no depth.
4. Forty covers on their shelves and five artifacts on none, with no links, give forty artifacts at depth 1
   and five with no shelf route, with no invented links. An empty shelf says it is empty.
5. The globe draws every shelf-placed artifact once beneath its home island at its computed
   longest-chain depth. Ghosts, proposals and retired artifacts add no points.
6. No-shelf artifacts form a small, distinct, stable cluster at the centre, wholly inside the
   shell. They gain no depth or invented shelf, and an empty corpus draws no points.
7. Forest and Library submit the same complete set of artifact points at the same positions
   and computed depths, with the same no-shelf centre cluster; hiding story nodes leaves the
   live core mounted.
