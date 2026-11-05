# One gate per linked pair, and tunnels under a third territory (ADR-1253 D3)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), The library close up, before (main at
b9ff8d1) and after this branch, at the same points of the map.

What this step draws (contracts 3.77 and 3.78, re-pinned):

- **One gate per link, and none elsewhere.** A gate stands where a link's road enters the capability it depends on (a way
  out to the sea: where it leaves its own), so neighbours get it on their shared border; links whose gates stand together
  still share one. Any other place a road crosses a border is open road: the border is cut open and a ramp climbs where it
  meets the open land, but no posts stand there. The library drew 20 gates on main and draws 16 now.
- **Tunnels.** Where every link on a road calls neither of the territories on one side of a border, the road goes under that
  territory: no road is drawn on it, and at each end a portal is laid on its land at the border, a dark mouth ringed with
  pale stone. Where a tunnel comes out into the capability its link depends on, that link's gate stands beside the portal.
  The library has two tunnels (four portals): the road from Waits under the territory south of it, and a road west from
  Knowledge entrances under its neighbour.
- A road that came onto a third territory sharing road with a link that calls it stays on the land until it leaves, so a
  tunnel always starts and ends at a border; this is why The library's other third-territory crossings (most of them on
  shared roads) are still drawn on the land.
- The router is unchanged: it still prefers routes round a third territory (2b's score).

Pictures, 1440 x 960:

- `before-the-library.png`, `after-the-library.png`: The library at 1.4 times the near zoom.
- `before-tunnel-1.png`, `after-tunnel-1.png`: round the first tunnel's portal near Waits, at ten times the near zoom: on
  main the road runs over the middle territory with a gate at each border; here it goes under it.
- `before-tunnel-2.png`, `after-tunnel-2.png`: round the second tunnel, west of Knowledge entrances.

Routing time, from each island's ask posted to its territory worker to its roads answered (software GL, the worker's start
included): The library 870 and 914 ms on this branch (it is asked twice as the map opens) against 803 and 969 ms on main;
all 29 islands 10.5 s together against 9.7 s, within the run-to-run spread. The cut into tunnels and gates walks each
road's border crossings once, which the gates already did. `before-measurements.json` and `after-measurements.json` hold
the counts and times.

Taken with `node --import tsx packages/forest/testing/view/island-tunnels/capture.mjs`, and on a checkout of main with the
same script and `--at <this branch's measurements.json>`, so its close-ups stand where this branch's portals do.
