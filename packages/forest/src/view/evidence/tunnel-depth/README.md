# Tunnels read as 3D, not flat holes in the ground (question_921aee319481, option B)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), before (main at 55de194) and after
this branch, at the same points of the map. Mick, 2026-11-06: "The tunnels look very 2D ... they look like flat holes in
the ground"; and, choosing portals plus a low rise over the tunnel, 2026-11-07: "they shouldn't necessarily be required to
be at the border between the capability nodes, because then they look a little bit more like the gates ... not a half
semicircle hole in the ground. I think the footprint should be smallish".

storytree's own map draws no tunnel today (every road goes round a third territory since #556), so each run gives The
library a few extra links its roads cannot route round, and pictures the tunnel that makes:

- `coast`: Project libraries depends on six more of its capabilities, and three others on one each. One tunnel, under the
  strip of land along The library's west coast.
- `hub`: Waits depends on twelve more. One short tunnel, under the corner of a territory in the middle of the island.

What is drawn now (contracts 3.77 and 3.78, re-pinned):

- **The mouth stands back from the border.** The road is drawn a short way onto the land it goes under (at most 1.8 of The
  library's units, leaving at least 3.2 under the land between the mouths where it can), and goes under there. The border
  is cut open where it crosses, as open road; a gate there, where the road comes into the capability it calls, still has no
  posts.
- **A low rise over the tunnel.** From mouth to mouth the land rises in straight facets (1.25 high, under the plateau's
  1.3): a crest over the tunnel's way, two flanks falling to it at most 2.3 either side, narrowed to stay on the land it goes
  under, a hipped end climbing from each mouth, and gentle humps along it. A tunnel too short for that stands under an
  oval knoll with a flat top. The flank toward the light is lit, the other shaded, the crest a little lighter, and it casts
  a short shadow away from the light. Nothing is raised anywhere else on the map.
- **A stone portal at each mouth.** A square headwall leaning into the rise's end, its arched mouth a little wider than the
  road, the road darkening on into it; its coping a straight bar of stone running back into the rise, so a mouth facing
  away still shows where the road goes under. The portal picked the links it carried (3.81, since retired:
  a portal now takes a click only where it stands as its road's gate, 3.88).

Pictures, 1440 x 960, at 8 times the near zoom (`*-tunnel-1.png`) and 12 times on each end (`*-end-1.png`, `*-end-2.png`):

- `before-coast-*.png`, `after-coast-*.png`: the coast tunnel.
- `before-hub-*.png`, `after-hub-*.png`: the short tunnel.

The look was iterated against five adversarial reviews of the pictures alone (a blind reviewer that read nothing else).
The last one judged the mouths facing the eye convincing portals, and still faulted the mouths facing away (a coping bar
with no opening, as from above a real one shows none), the long rise against the plateaus' crisper walls, and a tunnel
that still sits near a border where its road meets one.

What it costs, read where the box draws (SwiftShader, so no frame time is quoted; principle_ae45c9fde5e5): each tunnel adds
7 meshes to the selected island against 4 before, and 3,650 to 5,550 triangles against 72; building an island's relief with
one tunnel takes about 15 ms more, once, when its marks are made, and nothing on an island with none. Routing all 29
islands took 6.1 to 6.3 s on either side, within the run-to-run spread. `*-measurements.json` hold the counts and times.

Taken with `node --import tsx packages/forest/testing/view/tunnel-depth/capture.mjs --links <i:j,…> --prefix after-<name>
--retake`, and on a checkout of main with the same script, `--prefix before-<name>` and `--at <this branch's
after-<name>-measurements.json>`, so its pictures stand where this branch's tunnels do.

In the evidence bucket for #565, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `565/after-coast-tunnel-1-end-1.png`, `565/after-coast-tunnel-1-end-2.png`, `565/after-coast-tunnel-1.png`, `565/after-hub-tunnel-1-end-1.png`, `565/after-hub-tunnel-1-end-2.png`, `565/after-hub-tunnel-1.png`, `565/before-coast-tunnel-1-end-1.png`, `565/before-coast-tunnel-1-end-2.png`, `565/before-coast-tunnel-1.png`, `565/before-hub-tunnel-1-end-1.png`, `565/before-hub-tunnel-1-end-2.png`, `565/before-hub-tunnel-1.png`, `565/after-coast-measurements.json`, `565/after-hub-measurements.json`, `565/before-coast-measurements.json`, `565/before-hub-measurements.json`.
