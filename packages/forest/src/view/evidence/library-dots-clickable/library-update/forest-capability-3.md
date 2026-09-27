# The forest — capability 3

Apply these **field-level old → new** operations to the existing library records. Record IDs
below come from the read-only 2026-09-27T13-04-06-091Z snapshot. Read current live values
first and preserve later edits, sibling fields, links and shelf entries. Paths in the patch are
logical record targets, not repository files.

## REPLACE: Opening description

Target: **The forest, capability 3**, `capability_8ffc78a4bad2`, field `description`.

Old:

```text
The page opens in Forest mode, drawing every story node and its capability trees on the globe with the library core beneath them. Forest / Library switches this one globe (ADR-0660 D4): Library hides the story nodes and shows only the faint core points and the centre cluster. You can turn and zoom in either mode; Forest lets you select a story node. Switching preserves the scene, camera, rotation and zoom. Each launch defaults to Forest, with no saved mode. The flat forest and separate Look-inside view remain unavailable (ADR-0655).
```

New:

```text
The page opens in Forest mode, drawing every story node and its capability trees on the globe with the library core beneath them. Forest / Library switches this one globe (ADR-0660 D4): Library hides the story nodes and shows the knowledge points alone. You can turn and zoom in either mode, hover a visible artifact dot to see its title, and click a dot to read its summary in the right-hand story-panel slot (ADR-0661 D1/D2). Forest also lets you open a story by clicking its island. An artifact card and a story panel replace one another; Close and Escape dismiss the card. Switching modes preserves the scene, camera, rotation and zoom. Each launch defaults to Forest, with no saved mode. The flat forest and separate Look-inside view remain unavailable (ADR-0655).
```

## REPLACE: Globe-alone book: replace the obsolete centre pool

Target: **The forest, capability 3**, `definition_ce9a354beb4b`, field `meaning`.

Old:

```text
  - **The globe alone (ADR-0655 D1/D2):** the page opens on the globe in Forest mode, with a
    Forest / Library toggle (ADR-0660 D4), and no flat-forest or “Look inside” choice. The flat canvas remains in the engine, and knowledge-core calculations
    remain available in their own package. ADR-0658 mounts capability 1's faint points on
    this globe, with no-shelf artifacts pooled at the centre.
    See [the globe-only decision](../decisions/globe-only-and-room-for-pathways.md).
```

New:

```text
  - **The globe alone (ADR-0655 D1/D2):** the page opens on the globe in Forest mode, with a
    Forest / Library toggle (ADR-0660 D4), and no flat-forest or “Look inside” choice. The flat canvas remains in the engine, and knowledge-core calculations
    remain available in their own package. ADR-0658 mounts capability 1's faint points on
    this globe. ADR-0661 D3 removes story-text definitions from the drawing and spreads the
    remaining no-shelf knowledge through a filled ball.
    See [the globe-only decision](../decisions/globe-only-and-room-for-pathways.md).
```

## REPLACE: Point interaction and the shared right-hand panel

Target: **The forest, capability 3**, `definition_6ac190ac24f2`, field `meaning`.

Old:

```text
- **Knowledge beneath the islands, as built (ADR-0658):** the forest mounts
  `KnowledgeGlobePoints` through `@storytree/knowledge-core/view`, in `PlanetWorldCanvas`'s
  existing turning inside slot. The surface stays visible in Forest mode; Library hides it. Capability 1 still owns all
  placement calculations. The point layer adds no threads and intercepts no clicks; names,
  claims, failure markers and V2 pathways retain their existing drawing in Forest mode. The
  [seeded front and quarter-turn captures](../packages/forest/src/view/evidence/knowledge-under-islands/README.md)
  compare those layers against the same seed without points and exercise failure attention.
```

New:

```text
- **Knowledge beneath the islands, as built (ADR-0658, narrowed by ADR-0661 D1/D2):** the forest mounts
  `KnowledgeGlobePoints` through `@storytree/knowledge-core/view`, in `PlanetWorldCanvas`'s
  existing turning inside slot. Forest keeps its surface; Library hides it. Knowledge-core
  capability 1 owns the points, excludes story-text records and separates loose artifacts.
  The point meshes still bypass mesh raycasting, while a pure screen-space picker chooses
  the nearest eligible projected dot within 8 CSS pixels. Forest admits dots in the near
  half through the transparent shell, rejects far-side dots behind the shell, and lets land
  in front win over a dot behind it. Library has no surface occluder: every drawn dot can
  be picked when projected on-screen. Off-screen or clipped dots cannot be picked.
  Hovering a dot shows its title and a pointer cursor. Movement of 5 CSS pixels or more
  during a pointer gesture is a drag, including a drag that returns to its starting point.
  Clicking a dot uses the existing core pin and shared summary-card renderer in the right-hand
  story-panel slot; opening the card closes the story panel, and opening a story closes the
  card. Close and Escape dismiss the card. The card shows kind, title and summary fields,
  or the whole text when no summary exists; it has no links list, read counts, depth or
  entrances. The globe remains read-only. Forest names, claims, failure markers and V2
  pathways keep their existing drawing and story selection remains available.
  Evidence is in `packages/forest/src/view/evidence/library-dots-clickable/README.md`.
```

## REPLACE: Contract 3.9: Library uses the separated loose points

Target: **The forest, capability 3**, `contract_32a7d103a9f0`, field `title`.

Old:

```text
3.9 · Choosing Library hides every story node, including trees, names, claims, failure markers, selection rings, pathways and island overlays; only the core points at their computed depths and the no-shelf centre cluster are drawn. Choosing Forest restores the surface.
```

New:

```text
3.9 · Choosing Library hides every story node, including trees, names, claims, failure markers, selection rings, pathways and island overlays; only the core points at their computed depths and the separated no-shelf artifacts are drawn. Choosing Forest restores the surface.
```

## REPLACE: Contract 3.3: preserve story selection and replace an open card

Target: **The forest, capability 3**, `contract_fe6121ee074e`, field `title`.

Old:

```text
3.3 · Clicking a story node selects it.
```

New:

```text
3.3 · Clicking a visible story node selects it, opens its story panel and closes any artifact card.
```

## ADD: ADD contract 3.12, or the next free number

Target: **The forest, capability 3**, `new-contract-3.12`, field `title`.

Old: no corresponding contract in the snapshot. Add it under this capability; use the
next free number if the proposed number was taken later.

New:

```text
3.12 · In Forest and Library, hovering an eligible artifact dot shows its title and a pointer cursor, and clicking within 8 CSS pixels picks the nearest projected dot. Forest rejects far-side dots behind the shell and dots behind land; Library admits every on-screen drawn dot. Off-screen or clipped dots cannot be picked, and movement of 5 CSS pixels or more is a drag rather than a click.
```

## ADD: ADD contract 3.13, or the next free number

Target: **The forest, capability 3**, `new-contract-3.13`, field `title`.

Old: no corresponding contract in the snapshot. Add it under this capability; use the
next free number if the proposed number was taken later.

New:

```text
3.13 · Clicking an artifact dot opens its summary card in the right-hand story-panel slot and closes the story panel. Opening a story replaces the card. Close and Escape dismiss the card, and none of these actions writes to the library.
```
