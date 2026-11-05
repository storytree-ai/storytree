# Selecting an arc circles its open work (rollout 2, step 4b; ADR-1253 D1)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), with two active arcs in the stand-in
bridge whose open increments name real capabilities: the capability tree arc (Storytree projects on The app, Story node
render and Running sessions on The forest, Arc surface on The arc surface; a closed increment's capability is left out) and
a library arc (Library transactions on The library, Arcs and increments on The command line).

What this step draws (contracts 3.83 and 3.84; the feed is Work board 3.27, Running sessions 7.36 and Storytree projects 2.47):

- **No arc selected:** a small pale-cyan dot, on a dark casing, on every territory any open increment names. It stands on the
  cell site of its territory with the most room round it: clear of every name, settlement and gate, and its own width inside
  its coast and its border.
- **An arc selected** (its row clicked in the Arcs tab): each territory its open increments name is ringed in the same cyan,
  its own outline traced just inside its border; the island's other territories are dimmed, and every island it rings
  nothing on is dimmed whole, as a session's hover dims. Closing the card puts it back.

The ring follows the territory's outline rather than a circle round its name: a circle as wide as a territory spills onto
its neighbours, which on adjacent territories leaves it unclear which one is meant (the first stills of this branch).

Pictures, 1440 x 960:

- `no-arc-selected.png`: the whole map, dots only.
- `no-arc-selected-close.png`: The app, The forest and The arc surface, closer, dots only.
- `arc-selected.png`: the capability tree arc selected, the whole map.
- `arc-selected-close.png`: the same, closer.
- `arc-selected-the-forest.png`: the same, with The forest's island selected, so its roads, gates and settlements are drawn
  beside the rings and dots.

Taken with `node --import tsx packages/forest/testing/view/open-work/capture.mjs --retake`, which also counts every ring,
dot and dim from the scene into `measurements.json`.

In the evidence bucket for the pull request, linked from its body (ADR-1234; deleted after 90 days or when its arc closes).
