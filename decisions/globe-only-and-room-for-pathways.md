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
to 3 (placement, ghosts and reads) remain as calculations. Its implementation has already
landed; the globe-only page removes the entry point without deleting it. How the core is seen
returns when it is ready for review.

**D3 — Pathways come to the globe, with room for them.** They follow ADR-0169: a pathway is
a “builds on” link between capabilities, including across stories, drawn as a routed trail.
Islands must leave enough space for a trail between neighbours to read clearly, measured by
the trail's own width. A story never moves once placed (P1). Pictures go to the owner before
building how trails cross the gaps over the see-through shell; no land or bridges are added
unless he picks them. This narrows ADR-0648 D1's coasts only a few ground units apart.

The globe-only increment changes the page and preserves its `forestDrawn` smoke readout.
It does not widen placement or draw pathways. Those belong to `0-3-planet-pathways-look`
and the build it gates, `0-3-planet-pathways`; the current packing table remains in use here.

References: [the first globe](planet-first-slice.md), [the packed shell](planet-packed-see-through.md),
[the knowledge core](knowledge-core-capability-tree.md); ADR-0169 (0.2's pathway rule).
