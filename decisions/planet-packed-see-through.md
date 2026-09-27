# The globe packs its islands together on a see-through grey ball, with no sea

- **Front cover of:** stories/forest.md, capability 1
- **Full record:** ADR-0648 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0648`)

Accepted by the owner on 2026-09-27, after the real globe and the `spike/globe-land` look test.
His words: “A however you can make the ball a light transparent surface maybe a grey, this way
you can see the ball and you can see the landmass only covers a small part of it without it
looking like its floating with no sphere, there sphere however is still transparent”.

The first globe's seven stories were too far apart. The owner asked for closer land, without
sea or bridges, and transparency ready for the knowledge core. The look compared A, packed
islands with empty space beyond, against B, filled land between them, and C, B from a quarter
turn. A read best, but needed the ball's silhouette. B's coarse fill and its hiding the core at
36 stories were rejected.

**D1 — Packing.** Stories sit close together on a spiral from the front pole, with neighbouring
coasts a few ground units apart. Each spot comes from its permanent place number alone and
never moves when a story arrives or retires (P1). The radius is fixed. The approved look measured
radius 160 for 36 places. Places past capacity are refused until a later book decides them.
This replaces ADR-0646 D1's even spread, on the Story nodes shelf.

**D2 — No sea.** The surface is a light, see-through grey shell. It shows the ball's shape and
how little of it is covered by land, while admitting the far side and the future knowledge
core through areas without land. This replaces ADR-0646 D4's dark water and brings ADR-0629's
transparent surface forward into this slice, on the Story node render shelf.

**D3 — No bridges or filled continent in the MVP.** The islands and kit trees retain 0.2's
look unchanged. Land between them is not filled. A later pathways decision will decide joins.

ADR-0646's H1 (books on the forest's shelves), L1 (the light follows the eye) and the failing
island rule stand. The globe opens toward a failing island; edge markers bring a hidden failure
to the front. Names and claim markers keep their current rule and hide when behind. The flat
forest remains unchanged. The knowledge core is still unbuilt and reviewed separately.

As built, the 36 directions use the spike's spiral, with no live repacking. The table was
corrected before first landing because a fresh seed's different ids made its first two shores
overlap under the look-only table. Both seed shapes and all 36 sample shores now pass. The page uses
`placeOnPackedGlobe`. The even-spread implementation is retired; `placeOnGlobe` remains a
compatibility alias for existing callers. The shell uses light grey, 0.18 opacity, both faces,
and no depth writing. It keeps ray hits for the near-side labels and picking rule.

The clearance proof is bounded to the look's seed, a fresh seven-story seed, and all 36 sample shores at
their real sizes, including beaches (4–13 capabilities, original ids). It does not inherit W2's
100-place/19-capability guarantee: arbitrary growth or different coast shapes can crowd a
neighbour. Far-side trees can cross near coasts in the view. The
[measurements](../packages/forest/src/planet-places/measurements.md) state the bound, and the
[page pictures](../apps/desktop/src/forest/evidence/packed/README.md) show the result.

References: ADR-0646, ADR-0629, ADR-0642, ADR-0632; `spike/globe-land` and `spike/globe-look-2`;
storytree-ai/storytree #72, #74, #75 and #78. The spike branch itself is not merged.
