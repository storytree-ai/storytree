# A road leaving a gate runs down its ramp, not across it (increment_24ae471597e5)

Mick, 2026-11-07, with a screenshot of a road curving sideways off a ramp's tongue and over the cliff: "Can we make it
such that the pathway doesnt cut across the ramp".

The real desktop page on storytree's own map (the code-rows snapshot and its survey), before (main at c64225e) and after
this branch, framed on the middle of each of the map's 17 ramps (15 at a gate, 2 at open road), at 12 times the near zoom.

What is drawn now (contract 3.78): where a road crosses from a plateau onto the open land, the ramp is laid under the
crossing as before, and the road runs from the border straight down the ramp's middle to its foot (the ramp's depth along
its slope). Past the foot it turns in a curve that leaves the foot along the slope and meets the routed road along its own
way on, where that stands at least half as far again from the border, within a few ramps' depth of it, most nearly
straight on from the foot; the whole curve stands past the foot. The gates, their posts and the ramps stand where they did:
only the road's line past the border changes.

Pictures, 1440 x 960: `before-ramp-<n>.png` and `after-ramp-<n>.png` for n = 1 to 17, the same ramp at the same point;
`sheet-1.png` to `sheet-3.png` crop each pair round the ramp, before above after.

What still shows: where the routed road ran almost along the wall past the ramp (ramps 13 and 14), the turn past the foot
is a short S before it meets the road on, since the road now leaves at right angles to the wall.

Taken with `node --import tsx packages/forest/testing/view/ramp-lead-out/capture.mjs --prefix after --retake`, and on a
checkout of main with the same script, `--prefix before` and `--at <this branch's after-measurements.json>`.
