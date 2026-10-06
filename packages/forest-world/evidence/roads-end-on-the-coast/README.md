# Roads end on the island as drawn, not above it

The owner, 2026-10-06, on the website's globe: "can see our globe pathways has bugs", then "the payways look to flow
off the globe when they hit the edge rather then end".

**Cause.** Since ADR-0804 D1 an island is drawn bent onto the globe's sphere, but the roads between islands still took
their ends (docks) from the old flat plate standing tangent at the island's middle. A coast point `d` units out from
the middle stood about `d² / 2(R + clearance)` over the land as drawn, and a little inward of it. Each road eases its
height up to its dock over its last 8 units, so where a dock sat at the globe's edge, the climb showed past the edge as
a strand running off into space. On the website's own globe (`packages/website/src/own-snapshot.json`, radius 271):
The world's dock stood 13.06 units over the glass and The agent link's 10.07, where their coasts are drawn at 1.69.

**Fix** (`packages/forest-world/src/planet/pathways.ts`, the world's 6.12). Every point the roads take from an island
(its docks, its coast as the router sees it, and the island routes that selection lanes ride) is placed on the island's
surface as drawn (`onIslandSurface`). A short road, whose two 8-unit approaches overlap, now blends between its ends'
heights instead of adding them, so it no longer bulges above both. Every road now stays within 1.69 units of the glass
(the islands' own height) and ends on its island's drawn coast. The router sees each coast a little farther out than
before, so routes shift slightly.

**Pictures**, from `capture.mjs` (the engine's globe in Chromium, before = `origin/main` 4487caf0, after = this
branch, at the same turn, a road's farthest-out dock put 3° behind the globe's left edge):

- [the-world-before-after.png](the-world-before-after.png): before, The world's road runs off the left edge; after, it ends at the edge.
- [the-agent-link-before-after.png](the-agent-link-before-after.png): the same for The agent link's road.
- [whole-before-after.png](whole-before-after.png): the whole globe at The world's turn.

Heights in [measurements.json](measurements.json).
