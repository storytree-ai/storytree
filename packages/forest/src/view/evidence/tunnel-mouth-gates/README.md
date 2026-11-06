# A tunnel mouth stands for its gate, and sea arrivals keep out of a third territory

The real desktop page on storytree's own map (the code-rows snapshot and its survey), The library, before (this branch
with its two changes put back, equal to main) and after, at the same point of the map. Mick, 2026-11-06, on a screenshot
of The library by Waits: "If you have a tunnel maybe a gate isn't really needed as well? Also here not sure why the path
didn't just go right into connection by address, why did it need to go into waits."

What changes (contract 3.77):

- **No posts at a tunnel's mouth.** Where a road comes up out of a tunnel into the territory it calls, its gate stood two
  posts beside the portal. The portal now stands for that gate, with no posts. Any other gate keeps its two.
- **Sea arrivals come in from the open land.** An arrival's trunk paid 0.5 to go under a territory it does not call,
  against 25 for a road between two capabilities, so it climbed onto whichever plateau was cheapest and tunnelled under it.
  It now pays 60, more than a gate beside a settlement (18) and a long walk on the open land together. Across 60
  generated islands an arrival went under a third territory although its own capability's land met the open land 4 times
  at 0.5, once at 25 (and at 40, tried on 30 of them), and never at 60. Tunnels themselves fell from 61 portals to 26: what is left are roads
  that cannot reach their capability any other way.

The library drew 2 tunnel portals and 14 posted gates before, and draws no tunnel and 16 posted gates now: its one
tunnel was an arrival detour under a neighbour of Ranked search, which now reaches it on the land.

Pictures, 1440 x 960:

- `before-the-library.png`, `after-the-library.png`: The library at 1.4 times the near zoom.
- `before-tunnel.png`, `after-tunnel.png`: round where the tunnel's first portal stood, at ten times the near zoom.

Routing time for The library, from its ask posted to its territory worker to its roads answered: 1346 ms before, 1206 ms
after; all 29 islands 10.9 s against 10.5 s. `before-measurements.json` and `after-measurements.json` hold the counts.

Taken with `node --import tsx packages/forest/testing/view/island-tunnels/capture.mjs` (before with `thirdArrival` at 0.5
and the post skip removed; after with `--at <the before's measurements.json>`, so the close-up stands where the portal did).
