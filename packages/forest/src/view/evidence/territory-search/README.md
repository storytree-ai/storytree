# The network-scored territory search, off the page and kept (rollout 2, step 2b; ADR-1236 D1, ADR-1252)

Four islands at rest, selected, drawn by the real map code on this branch once its territory search had run in the
page's territory worker and kept its arrangement, beside rollout 1's mock of the same island
(`docs/design/capability-tree-3d/q-all-islands/stills/islands/after/<story>-rest.png`).

What this step does (contract 3.80): the selected island's arrangement (3.76's start) is improved by the mock's
simulated annealing, 300 steps seeded at 43, each arrangement scored on the shared road network routed over it (10 an
inside link through a third territory, 3 each border it crosses, 0.05 a unit of road, less 4 an inside link between
neighbours, 500 an interface off the coast). It runs only in the worker the page names; what it finds is kept in the
page's storage per story under the island's structure key, so the island is searched once and a change of lines only
resizes it.

The mock's arrangements came from a longer search started from round 3's hand-placed layout, so the two arrangements
differ; the mock also draws the wrench and the legend (steps 4b and 6).

Searching took, in the page's worker on the Mint box: The library 378 s, Session management 138 s, The command line
142 s, Setup 140 s.

Taken with rollout 1's kit, which now builds and names the territory worker: `node docs/design/capability-tree-3d/q-all-islands/tools/build.mjs`, then
`node --import tsx docs/design/capability-tree-3d/q-all-islands/tools/docks.mjs --stills --searched <story>...`.

In the evidence bucket for the pull request, linked from its body (ADR-1234; deleted after 90 days or when its arc
closes): `<pr>/territory-search/the-library.png`, `<pr>/territory-search/session-management.png`,
`<pr>/territory-search/the-command-line.png`, `<pr>/territory-search/setup.png`.
