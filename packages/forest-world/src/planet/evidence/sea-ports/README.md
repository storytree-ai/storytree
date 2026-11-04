# Pale-blue sea lanes and ports (rollout 2, step 5; ADR-1236 D1)

Four islands at rest, selected, drawn by the real map code on this branch, beside rollout 1's mock of the same island
(`docs/design/capability-tree-3d/q-all-islands/stills/islands/after/<story>-rest.png`).

What this step draws (contracts 4.8 and 4.40): every lit lane at sea one solid pale sea-blue line (#8fbfd4 mixed into
the sea at 0.78, #80acbf), in and out alike, no glow and no second colour, a step wider where more lanes share a
stretch (0.32, 0.5, 0.78, 1.15 ground units for 1, 2-7, 8-31, 32 or more), drawn in place of the road it rides. At the
selected island each lane eases off its line onto a berth three units off the coast, so it never meets the island's
road; behind the berth, where the road ends, a port: a low building with a capped tower either side, twice as tall,
in the gate posts' slate and ink, no jetty. Docks within a port's width of a busier one share its port, and ports
scale with the island's land against The library's.

Not yet: the legend naming the shipping lane and the port (step 6). The mock also breaks the white coast line in front
of each port; the real map keeps it whole. The territory layouts differ from the mock's where step 2b's network-scored
search has not landed.

Taken with rollout 1's kit: `node docs/design/capability-tree-3d/q-all-islands/tools/build.mjs`, then
`node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/docks.mjs --stills <story>...`.

In the evidence bucket for #441, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `441/the-library.png`, `441/the-library-beside-mock.png`, `441/session-management.png`, `441/session-management-beside-mock.png`, `441/the-command-line.png`, `441/the-command-line-beside-mock.png`, `441/setup.png`, `441/setup-beside-mock.png`.
