# Island gates stand apart where their border has room (increment_af16a373441d)

Mick, 2026-11-08, with a screenshot of the Code map island: "push the gates away from each other if possible, looks like
here they dont need to crowd together but they do".

What was wrong: the router kept two gates' entrances 6 of The library's units apart, middle to middle, but a gate's posts
reach about 2.9 either side of its middle (half its 3-unit opening and a 1.4-unit post), 3.1 where a ramp climbs to it from
the open land. So two gates at the least spacing stood with their posts touching, or overlapping at a ramp.

What is drawn now (contract 3.77, one clause added): the router keeps entrances 9 apart (`COST.entranceApart`), so two
gates on one island stand with at least 2 units of clear ground between their nearest posts wherever their border has
room. Where it has not, a link shares a gate or comes in beside one, as before. Nothing else about the roads changed.

## Measured: every island's posts

storytree's own plan and code as of 2026-11-08 (the code-rows seed and survey refreshed from the library and this checkout,
read-only, not committed). Each island's ask to route its roads was taken from the page (`capture.mjs --dump`), then every
island was routed at each spacing (`gates.mjs`). Gaps are the clear ground between the nearest posts of two gates, in The
library's units:

| entrance spacing | gates with posts | pairs under 1 apart | least gap | road drawn | tunnels | links over a third territory | unrouted | slowest island |
|---|---|---|---|---|---|---|---|---|
| 6 (main) | 232 | 7 | -0.22 (Setup) | 11264 | 4 | 229 | 0 | 926 ms |
| 9 (here) | 228 | 0 | 2.98 | 11330 | 4 | 227 | 0 | 701 ms |

On main, posts stand under 1 unit apart on The library (0.19), Session management (0.66), Desktop app (0.45), Map view
(0.44), Setup (-0.22, overlapping) and Mick's dev loop (0.85). At 9, none does. Roads are 0.6% longer in all, the tunnels
are the same four, and four gates fewer are drawn because a few links now share one. At 10 the router drew 10 tunnels, so 9
it is.

Not reproduced: the layout in Mick's screenshot. His app keeps each island's arrangement as it was first searched (3.94),
and this capture searches afresh, so its Code map island is laid out differently, and there its gates already stood apart.
Every island's arrangement is unchanged by this branch: only its roads re-route, so his Code map island keeps its shape and
its gates spread out.

## Pictures

1440 x 960, each island faced at 1.4 times the near zoom (`*-code-map.png`, `*-setup.png`, `*-the-library.png`), and at
6 times on main's three tightest pairs of posts of two different gates on each (`*-close-1.png` to `*-close-3.png`), the
same points before (main's spacing, 6) and after (9). Setup's `close-1` is the worst on main: two gates into Built commands
with their posts overlapping, which after stand as two separate pairs down the border.

Taken with `node --import tsx packages/forest/testing/view/gates-apart/capture.mjs --seed <folder> --prefix before|after
--islands "Code map,Setup,The library" --retake` (after with `--at <before-measurements.json>`), before with
`entranceApart` set back to 6, and measured with `node --import tsx packages/forest/testing/view/gates-apart/gates.mjs
<asks.json> 6 9`.

In the evidence bucket for #636, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `636/after-code-map-close-1.png`, `636/after-code-map-close-2.png`, `636/after-code-map-close-3.png`, `636/after-code-map.png`, `636/after-setup-close-1.png`, `636/after-setup-close-2.png`, `636/after-setup-close-3.png`, `636/after-setup.png`, `636/after-the-library-close-1.png`, `636/after-the-library-close-2.png`, `636/after-the-library-close-3.png`, `636/after-the-library.png`, `636/before-code-map-close-1.png`, `636/before-code-map-close-2.png`, `636/before-code-map-close-3.png`, `636/before-code-map.png`, `636/before-setup-close-1.png`, `636/before-setup-close-2.png`, `636/before-setup-close-3.png`, `636/before-setup.png`, `636/before-the-library-close-1.png`, `636/before-the-library-close-2.png`, `636/before-the-library-close-3.png`, `636/before-the-library.png`, `636/before-measurements.json`, `636/after-measurements.json`.
