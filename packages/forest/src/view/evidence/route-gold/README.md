# A picked link lights its whole way in gold (rollout 2, step 3c; ADR-1236 D1)

Four islands at rest, selected, drawn by the real map code on this branch, each after one click on its map: the click
lands on a road, and the map's own pointer handler picks it.

What this step does (contract 3.81, ported from the capability tree mock's `overlay.ts` pick and highlight): the
selected island's roads and gate posts take a click. A road carrying one link, or the gate a link enters by, picks that
link, and its whole way lights in gold (#ffd34d) on a thin dark edge: every road segment it travels, and its entrance
gate's post faces. A shared road, or a gate on one that no link enters by, picks that road, which lights alone. Picking
anything else puts the gold out; a road or gate pick changes no selection.

- The library: a link between two of its capabilities, its way over 12 road segments.
- Session management: a way out to the sea, over 8 segments.
- Setup: a link inside the island, over 4 segments.
- The command line: no road there carries a single link, so the click picks a shared trunk carrying 16 links, which
  lights itself alone.

Islands are shown in the start arrangement (3.76), taken before the territory search (3.80) kept one.

Taken with rollout 1's kit: `node docs/design/capability-tree-3d/q-all-islands/tools/build.mjs`, then a scratch
script that opens `index.html?story=<id>&layout=today&real`, projects the middle of the chosen road to the screen and
clicks it with the mouse.

In the evidence bucket for #470, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `470/route-gold/the-library.png`, `470/route-gold/session-management.png`, `470/route-gold/setup.png`, `470/route-gold/the-command-line-shared-road.png`.
