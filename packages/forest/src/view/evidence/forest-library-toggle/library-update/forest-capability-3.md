The page opens in Forest mode, drawing every story node and its capability trees on the globe
with the library core beneath them. Forest / Library switches this one globe (ADR-0660 D4):
Library hides the story nodes and shows only the faint core points and the centre cluster.
You can turn and zoom in either mode; Forest lets you select a story node. Switching preserves
the scene, camera, rotation and zoom. Each launch defaults to Forest, with no saved mode.
The flat forest and separate Look-inside view remain unavailable (ADR-0655).

- **Depends on:** 1 and 2. It is kept current by the arc surface's live reading, and sits in the 0.3
  app's frame (the 0.3 app's story, ADR-0632 D4); until that story is built it uses today's project
  dropdown as it is.
- **Its shelf,** founding book first:
  - **Founding book:** the land look endorsed for 0.2 is ported as it stands, with no art research
    (ADR-0625 D4, ADR-0508).
  - The forest keeps 0.2's fixed view and full-size seedlings (ADR-0642, decisions/adr-0642.md).
  - **Planet book: a failing island is never hidden** (ADR-0646, H1). The globe opens facing a
    failing island: any dead tree makes its island failing, as in the ground's worst-form rule.
    If several fail it faces the first in story order; if none fail it faces the first story.
    A failing island on or behind the horizon gets an edge marker, whose turn brings it to the
    front. `openingTurn`, `edgeMarkers` and `turnToIsland` in `packages/forest/src/never-hidden`
    calculate this without drawing: absolute north-up turns and unit-circle marker positions.
    Pure tests prove opening toward failure, a hidden island's marker bringing it to the front,
    and no marker for a failure already in front. Forest mode draws those markers.
    **Narrowed by ADR-0660 D4:** the never-hidden rule binds Forest mode. Library is the
    viewer's explicit choice to hide all story nodes, including failing islands and their
    markers. Returning to Forest restores its failure attention without resetting the view.
  - **Packed land on a see-through grey ball (ADR-0648):** the globe has a light grey transparent
    shell with a clear middle, a bright rim and one soft highlight under L1 (the owner’s
    glass-ball tuning after #93), with no sea, bridges or filled continent. The far side shows
    through empty areas;
    names, claims and clicks keep their near-side rule. The islands and kit pines keep their
    existing drawing, and L1 keeps the light over the viewer's shoulder. The knowledge core
    shows faint artifact points beneath the islands (ADR-0658); ADR-0655 D2 still defers
    the separate Look-inside page entry.
    See [the decision](../decisions/planet-packed-see-through.md).
  - **The globe alone (ADR-0655 D1/D2):** the page opens on the globe in Forest mode, with a
    Forest / Library toggle (ADR-0660 D4), and no flat-forest or “Look inside” choice. The flat canvas remains in the engine, and knowledge-core calculations
    remain available in their own package. ADR-0658 mounts capability 1's faint points on
    this globe, with no-shelf artifacts pooled at the centre.
    See [the globe-only decision](../decisions/globe-only-and-room-for-pathways.md).
  - **Routed pathways (ADR-0655 D3, V2; ADR-0169):** every recorded capability link
    has one trail chain, within and across islands. Cross-island trails are raised, faintly
    lit ribbons over the glass, docking at both shores; see
    [the pathway book](../decisions/planet-pathways.md).
  - Only meshes exported from the bought pine kit ship, never the kit itself. Its licence allows
    derived output and forbids repackaging, as 0.2 applied it (ADR-0418).
  - The look is judged by the owner's eye, with a screenshot at each landing that changes it.
- **Leaves out (vs 0.2), by the owner's decision** (ADR-0635, c1 to c3): the 2D map that took the
  clicks while the 3D picture sat underneath; the rig for measuring looks, 72,875 of 0.2's 142,439
  forest lines, with its texture and palette ladders, crowd scenes and true-ground projection; and
  the website mount.
- **As built:** the plan is `forestScene(tree, history, states)` in `packages/forest`: every story
  node an island at its place (one place-width is 16 world units), its grove set out from the
  middle like a sunflower's seeds in build order, and its name. `forestDrawn` says what was drawn as
  the smoke check reads it (`surface: "forest"`, with each tree's form and the names added),
  `changedIslands` names the islands a change touched, and `storyAt` is the island under a point on
  the flat ground. The engine retains 0.2's forest canvas and `forestDescriptors`: one hex tile
  per capability relaxed into its ground mesh, a smoothed coast, and one parcel per capability
  wearing its tree's form, with ground cover grown from contract count. The globe reuses that
  island drawing and 0.2's kit pines (only `dressing-kit.glb` ships, never the kit).
  The page (`packages/forest/src/view/forest-view.tsx`) mounts the globe alone. The desktop
  imports `openForestView`, `renderStoryPanel` and `renderUnclaimed` from `@storytree/forest/view`;
  the view, navigation, overlays, tests and evidence live in the forest package, with no
  `NOT_YET_MOVED` exception (ADR-0649 D2). Its story names,
  island clicks, selection rings and claim markers live in the same scene. The arc surface's
  live reading keeps it current: the tree is read again only when the library changed, and
  unchanged islands retain their objects so only changed islands are recomputed.

- **Packed globe, as built:** the page's `planetLayout` selects the frozen packed spots, and
  `PlanetWorldCanvas` mounts each unchanged island as a tangent plate above a radius-218 shell.
  A small shader on the same double-sided shell makes it read as glass: a nearly clear middle,
  a brighter Fresnel rim, and one soft highlight from L1's lamp over the viewer's shoulder.
  The centre's base opacity is 0.012; the highlight stays faint enough to retain at least 80%
  of the far-side contribution through the middle. Depth writing stays off. Its ray hits still
  hide back-side labels and claims and stop clicks selecting a hidden island. Opening turns,
  edge markers and story selection keep working. The page has a Forest / Library mode switch (ADR-0660 D4); `forestDrawn`
  continues to report its seeded stories and capability trees to the smoke check.
  [Headless Chromium comparisons](../packages/forest/src/view/evidence/glass/README.md) show the
  seeded page before (#93) and after this tuning, with the renderer named. The
  [globe-only page capture](../packages/forest/src/view/evidence/globe-only/README.md) records
  the later removal of the page choices and the surviving selection and smoke journey.

- **Knowledge beneath the islands, as built (ADR-0658):** the forest mounts
  `KnowledgeGlobePoints` through `@storytree/knowledge-core/view`, in `PlanetWorldCanvas`'s
  existing turning inside slot. The surface stays visible in Forest mode; Library hides it. Capability 1 still owns all
  placement calculations. The point layer adds no threads and intercepts no clicks; names,
  claims, failure markers and V2 pathways retain their existing drawing in Forest mode. The
  [seeded front and quarter-turn captures](../packages/forest/src/view/evidence/knowledge-under-islands/README.md)
  compare those layers against the same seed without points and exercise failure attention.

- **Forest / Library, as built (ADR-0660 D4):** two labelled buttons use the page's existing
  control styling. `openForestView` owns the mode for this mount, initially Forest.
  `PlanetView` uses the existing `PlanetWorldCanvas.surface` seam: Library hides the shell,
  islands, trees, names, claim markers, selection rings, pathways and island overlays.
  Navigation stays mounted, suppresses failure markers and island picking in Library, and
  keeps its opening turn and rotation. Choosing Library clears the selected story and closes
  its drill-down. The canvas, core subscription, point positions, camera and orbit controls
  stay mounted; turning and zooming work in either mode. There is no persistence, new flat
  view or Look-inside mount. Renderer-submission counts, both angles and the failure journey
  are in `packages/forest/src/view/evidence/forest-library-toggle/README.md`.

- **Pathways, as built:** `forestScene` carries the library's capability dependencies into
  `buildPlanetPathways`. The ported cost-grid router merges shared routes, counts their
  original links, and samples cubic curves before drawing. On-land segments feed
  the existing worn-ground material with its unchanged falloff; cross-island segments form
  the V2 ribbon, with width from original-link usage, exact
  coast docks and no raycast occlusion of names or markers. The complete chain of segment
  references remains available for every link. Missing endpoints or unroutable links produce
  a visible pathway error while all islands and their failure markers remain available. The current seed has 75 local and 28
  cross-story links. [Seeded front and quarter-turn captures](../packages/forest/src/view/evidence/planet-pathways/README.md)
  record the renderer, link counts, ribbon widths and coast gaps.

**Contracts:**
1. The app opens a seeded project on the globe in Forest mode; its smoke check finds one story node per
   story, each drawn with its capability tree.
2. A capability landing redraws just its story node, without a reload.
3. Clicking a story node selects it.
4. Each near-side story node shows its story's name, readable as the globe turns and zooms (ADR-0636
   D4: in 0.2 the names lived on the 2D map the owner cut, so the 3D forest carries them).
5. The globe’s glass shell has a nearly clear middle, admitting at least 80% of the far-side
   contribution through both faces, with a bright rim and one soft highlight; there is no opaque sea.
6. Every recorded "builds on" link has exactly one continuous trail chain; shared trunks are
   drawn once and their width counts the original links.
7. A cross-story link docks at both actual clipped shores and continues to its capabilities.
8. Up to the stated 36-place capacity, the measured coasts leave the approved width-derived
   pathway clearance, while every previously placed direction remains fixed.
9. Choosing Library hides every story node, including trees, names, claims, failure markers,
   selection rings, pathways and island overlays; only the core points at their computed
   depths and the no-shelf centre cluster are drawn. Choosing Forest restores the surface.
10. Switching either way preserves the canvas, scene, core, camera, rotation and zoom. Library
    remains orbitable; choosing it clears story selection and its panel, and hidden islands
    cannot be picked. A new launch defaults to Forest.
11. In Forest mode a failing island is never hidden: opening faces a failure; a far-side failure
    has an edge marker whose click reveals it, including after returning from Library.
    Library is the viewer's explicit choice to hide story nodes (ADR-0660 D4).
