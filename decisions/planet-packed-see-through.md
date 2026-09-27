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

**Spacing narrowed, 2026-09-27 (ADR-0655 D3).** The owner found these islands cramped and
asked for room for pathways. The next spacing follows the trail's width while preserving P1.
That look and build are separate increments; the globe-only page change keeps the current table.

**D2 — No sea.** The surface is a light, see-through grey shell. It shows the ball's shape and
how little of it is covered by land, while admitting the far side and the future knowledge
core through areas without land. This replaces ADR-0646 D4's dark water and brings ADR-0629's
transparent surface forward into this slice, on the Story node render shelf.

**D3 — No bridges or filled continent in the MVP.** The islands and kit trees retain 0.2's
look unchanged. Land between them is not filled. ADR-0655 D3 calls for a picture review of how
trails cross the gaps before they are built; no land or bridges are added unless the owner picks them.

ADR-0646's H1 (books on the forest's shelves), L1 (the light follows the eye) and the failing
island rule stand. The globe opens toward a failing island; edge markers bring a hidden failure
to the front. Names and claim markers keep their current rule and hide when behind. The flat
canvas remains in the engine. **Page choice narrowed, 2026-09-27 (ADR-0655 D1/D2):**
the page offers the globe alone, with no Forest or “Look inside” entry point. The knowledge
core implementation already landed, but its page entry is deferred. The owner’s K1 choice on 2026-09-27
(`oq-0-3-knowledge-core-through-the-shell`) keeps it out of the ordinary Globe view;
D2’s readiness for a future visible core does not add that overlay.

As built, the 36 directions use the spike's spiral, with no live repacking. The table was
corrected before first landing because a fresh seed's different ids made its first two shores
overlap under the look-only table. Both seed shapes and all 36 sample shores now pass. The page uses
`placeOnPackedGlobe`. The even-spread implementation is retired; `placeOnGlobe` remains a
compatibility alias for existing callers. The shell uses the glass tuning below, both faces,
and no depth writing. It keeps ray hits for the near-side labels and picking rule.

**Shell tuning, 2026-09-27.** After seeing #90's 0.18 shell in the real app, the owner said
“needs to be more transparent”. Increment `0-3-planet-shell-more-transparent` lowered opacity to
0.08, tuning D2 rather than making a new decision. Both faces together then retained 84.6% of the
far-side blend contribution (`0.92²`), compared with 67.2% before (`0.82²`). The existing shell
test protects at least 80% transmission and a nonzero shell, without pinning the exact colour
or opacity. The ball's outline remains visible in the
[front and quarter-turn comparisons](../packages/forest/src/view/evidence/shell/README.md).
The shell comparison showed the seeded islands through the shell, with no core placeholder.

**Glass tuning, 2026-09-27.** After #93 the owner said “doesnt look seethrough, maybe try
making it look like a glass ball, if thats hard dw about it its not something we need to
worry about right now”. Increment `0-3-planet-glass-shell` tunes D2 on that direct instruction.
The same shell mesh now has a small shader: a nearly clear centre, a light grey Fresnel rim,
and one soft highlight aligned with the existing L1 lamp. Only the near face carries the
highlight, so there is no second reflection behind it. The orthographic view and view-space
normal keep the highlight with the light while the globe turns.

The centre's base opacity is 0.012 (97.6% background contribution through two faces before
the highlight); the highlight is capped at 0.16 added opacity. The shader keeps the existing
back-face/front-face draws and ray hits, with depth writing off. It needs no transmission
buffer, refraction, post-processing, extra mesh or render target. Placement, islands, kit,
light, labels, claims and picking retain their existing code. The earlier 80% test remains,
with a 95% clear-centre base target added red then green; the rim and highlight are judged in
the [matched seeded captures](../packages/forest/src/view/evidence/glass/README.md), with an
actual shader pixel readback checking the composited transparency. These are shell changes
only; that landing left the knowledge core's separate “Look inside” view unchanged. ADR-0655
subsequently removes its page entry, as noted above.

The clearance proof is bounded to the look's seed, a fresh seven-story seed, and all 36 sample shores at
their real sizes, including beaches (4–13 capabilities, original ids). It does not inherit W2's
100-place/19-capability guarantee: arbitrary growth or different coast shapes can crowd a
neighbour. Far-side trees can cross near coasts in the view. The
[measurements](../packages/forest/src/planet-places/measurements.md) state the bound, and the
[page pictures](../packages/forest/src/view/evidence/packed/README.md) show the result.

References: ADR-0646, ADR-0629, ADR-0642, ADR-0632; `spike/globe-land` and `spike/globe-look-2`;
storytree-ai/storytree #72, #74, #75 and #78. The spike branch itself is not merged.
