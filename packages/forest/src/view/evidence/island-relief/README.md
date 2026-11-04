# Plateaus, bevel rims, ramps and standing posts on the selected island (rollout 2, step 3b; ADR-1236 D1)

Four islands at rest, selected, drawn by the real map code on this branch, beside rollout 1's mock of the same island
(`docs/design/capability-tree-3d/q-all-islands/stills/islands/after/<story>-rest.png`).

What this step draws (contract 3.78, round 11's relief): every territory a plateau 1.3 of The library's units above
the open land, at the island's own scale; a wall wherever a plateau meets the open land or the coast, shaded by the
light from the page's upper left, with a soft shadow on the open land where it faces away; a ramp only at a gate where
a road climbs from the open land onto a territory; a bevel rim inside every border, light toward the light and dark
away from it, broken at each gate; and each gate's posts standing up (slate sides, an ink top with a paper face, a
soft shadow), beside the ramp where there is one. The roads and claim marks lie on the land as it stands. Contract 3.77
is re-pinned: its posts now stand on the relief rather than lying flat (step 3a).

Not yet: a picked link lit in gold (step 3c), settlement symbols and names placed clear of them (step 4), and the
pale-blue sea lanes and ports (step 5). The mock's stills show all of those.

Taken with rollout 1's kit: `node docs/design/capability-tree-3d/q-all-islands/tools/build.mjs`, then
`node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/docks.mjs --stills <story>...`.

In the evidence bucket for #440, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `440/island-relief/the-library.png`, `440/island-relief/session-management.png`, `440/island-relief/the-command-line.png`, `440/island-relief/setup.png`.
