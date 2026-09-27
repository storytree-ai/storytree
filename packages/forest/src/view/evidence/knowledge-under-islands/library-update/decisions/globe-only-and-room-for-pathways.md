# The globe is the only view, and islands get room for pathways between them

- **Front cover of:** stories/forest.md, capability 3
- **Full record:** ADR-0655 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0655`)

Accepted by the owner on 2026-09-27, looking at the packed globe in his own app. His words:
“the islands look cramped, we dont need a forest only option or a lookinside option yet just
stick with globe. We need pathways and enough space for the pathways, is there an arc track
for that? is it qued?”

**D1 — The globe is the only view.** The Globe / Forest button goes, and the page opens on
the globe alone. The flat forest canvas remains in the engine because the globe's islands
are drawn with its parts. This narrows ADR-0646's one-click flat view, not the engine's abilities.

**D2 — No “Look inside” yet.** The knowledge core's page entry is deferred. Capabilities 1
to 3 (placement, ghosts and reads) initially remained as calculations. Its implementation has already
landed; the globe-only page removes the entry point without deleting it.
**Narrowed in place by ADR-0658 (2026-09-27):** capability 1's placements now show as faint
points beneath the islands, with no-shelf artifacts at the centre. Ghosts and reads remain
calculations, and Look inside stays unmounted. See [the knowledge layer](knowledge-under-islands.md).

**D3 — Pathways come to the globe, with room for them.** They follow ADR-0169: a pathway is
a “builds on” link between capabilities, including across stories, drawn as a routed trail.
Islands must leave enough space for a trail between neighbours to read clearly, measured by
the trail's own width. A story never moves once placed (P1). The owner picked **V2** on 2026-09-27 from `spike/globe-pathways`: slightly raised,
faintly lit ribbons over the glass, docking at the shores. No land or bridges are added.
The [pathway book](planet-pathways.md) records the implementation and its evidence. This narrows ADR-0648 D1's coasts only a few ground units apart.

The globe-only increment preserved its `forestDrawn` smoke readout. The subsequent
`0-3-planet-pathways` build widens the radius to 218, keeps every frozen direction and
the 36-place capacity, and draws the links the library records.

References: [the first globe](planet-first-slice.md), [the packed shell](planet-packed-see-through.md),
[the knowledge core](knowledge-core-capability-tree.md); ADR-0169 (0.2's pathway rule).
