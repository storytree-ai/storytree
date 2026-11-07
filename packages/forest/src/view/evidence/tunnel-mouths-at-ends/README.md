# A tunnel's mouths stand in the capabilities that need it (increment_6e6238823120)

Mick, 2026-11-07: "both the tunnel entrance and exit sit inside Connection by address, so it looks like the tunnel is
owned by Connection by address. What I'd expect is the other capability, Work in flight, tunnelling under Connection by
address to get into Weights. The tunnel entrance and exit should sit inside the capability that needs it."

What is drawn now (contracts 3.77 and 3.78, re-pinned):

- **Each mouth stands on the land on its road's side of the border**, set back from it up to 1.8 of The library's units
  (at most 0.6 of its road on that land), so the entrance stands in the territory the road comes from and
  the exit in the territory it goes into. The tunnel runs from mouth to mouth, under the border and the whole of the land
  it passes under, and the rise over it (3.78) runs from mouth to mouth with it.
- **Where the road's side of a border is open land**, the mouth keeps today's place: set back onto the land it goes under,
  since open land is no capability's. Where it is another territory the road also goes under, there is no mouth there: the
  tunnel runs on under both.
- **Unchanged:** the border is cut open where the road crosses it; a gate there, where the road comes up into the
  capability it calls, still has no posts, and its portal stands for it and picks as the gate does (3.81, 3.88). The
  legend's portal entry is unchanged.

storytree's own map (the code-rows snapshot) still draws no tunnel on any island, after this change as before, so the
capture gives The library extra links its roads cannot route round, as #565's `hub` run did: Waits depends on every other
capability of The library (`--links 10:0,…,10:13`). That makes The library's one tunnel. #565's `coast` run's links were
not recorded, so it is not retaken.

Pictures, 1440 x 960, at 8 times the near zoom (`*-tunnel-1.png`) and 12 times on each end (`*-end-1.png`,
`*-end-2.png`), before (main at 0ecc090) and after, at the same points of the map:

- `before-hub-*.png`: both mouths on the narrow strip the road passes under.
- `after-hub-*.png`: each mouth on the land beyond that strip, the road sinking into it there.

Routing all 29 islands in their workers took 6.4 to 7.4 s across three runs on this branch, against 6.5 s on main and
6.5 s on this branch with no extra links: within the run-to-run spread (the mouth's place is set after routing, once per
road). `*-measurements.json` hold the counts and times.

Taken with `node --import tsx packages/forest/testing/view/tunnel-depth/capture.mjs --links <…> --prefix after-hub`, and
on a checkout of main with the same script, `--prefix before-hub` and `--at <this branch's after-hub-measurements.json>`.

In the evidence bucket for #602, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `602/before-hub-tunnel-1.png`, `602/after-hub-tunnel-1.png`, `602/before-hub-tunnel-1-end-1.png`, `602/after-hub-tunnel-1-end-1.png`, `602/before-hub-tunnel-1-end-2.png`, `602/after-hub-tunnel-1-end-2.png`, `602/before-hub-measurements.json`, `602/after-hub-measurements.json`.
