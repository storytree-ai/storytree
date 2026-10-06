# Roads are routed on a chart centred on the islands

Residue of increment_f701a58d03b2, built by increment_a8aedbba7136 (the world's 6.14).

**Cause.** Roads between islands are planned on a flat azimuthal chart of the globe, and the chart was always centred on
the globe's +z. An island far round from that pole is stretched sideways on the chart (θ/sinθ: 2.5 times at 122°, 3.3
at 135°), and the router sees each island as the disc its farthest charted coast reaches, so for a far island that disc
reached well past the real coast and the road stopped short of it. Since f701a58d03b2 the rest of the way is filled in
along the globe's surface, so nothing cuts through the glass, but that stretch is never routed: it runs straight,
ignores other roads and islands, and merges with nothing.

**Fix** (`packages/forest-world/src/planet/pathways.ts`, `chartPole`). The chart's pole is the direction whose
farthest island coast is nearest (a minimax over a fixed spiral of 2000 directions, then refined). It depends only on
where the islands are, so routes keep still while no island moves; when one moves, every road is routed again, as
before. Every road on an existing globe moves once.

**Measured** on storytree's own plan (the code-rows seed, `snapshot.mts`, radius 218), the longest stretch of any road
filled in along the surface rather than routed: **220.5 units (58.0°) before, 75.9 units (20.0°) after.** Before
is this branch with the pole forced back to +z, which routes exactly as `origin/main` 88f01b5a does.

**What is left.** The router still sees each island as a disc of its farthest charted coast. A big island off the
pole is still stretched somewhat, and a coast that dips inside its disc (most islands' do: on the seed above The agent
link's road docks 62 units out on an island reaching 107) leaves a road short by the dip. That is parked on the arc as
increment_827c10e70b39: route to the islands' real outline, not a disc.

**Pictures**, from `capture.mjs` (the engine's globe in Chromium, before = `origin/main` 88f01b5a, after = this branch,
same turn):

- [between-before-after.png](between-before-after.png): 45° from The world toward The librarian. Before, a straight
  unrouted strand runs from The world across the sea, grazing an island; after, the roads there are routed and join.
- [the-librarian-before-after.png](the-librarian-before-after.png): facing The librarian; before, the long straight
  strand toward The world crosses the lower right; after, it is a routed road.
- [the-world-before-after.png](the-world-before-after.png): facing The world.
