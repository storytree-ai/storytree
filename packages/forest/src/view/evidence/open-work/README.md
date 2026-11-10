# Selecting an arc rings its open work (ADR-1253 D1 as corrected 2026-11-05)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), with two active arcs in the stand-in
bridge whose open increments name real capabilities: the capability tree arc (Storytree projects on The app, Story node
render and Running sessions on The forest, Arc surface on The arc surface, Library transactions on The library; a closed
increment's capability is left out) and a library arc.

What this step draws (contracts 3.83, 3.84 and 3.86):

- **No arc selected:** no open-work mark at all. The always-on dots are gone (Mick, 2026-11-05: "they show even though i
  have no arc selected and also they filled in circles").
- **An arc selected** (its row clicked in the Arcs tab), with the territories showing: a hollow pale-cyan ring, like a
  game's unit-selection ring, round each capability its open increments name, round its settlement symbol (or its nameplate
  where it has none), sized to the symbol with a little room and never less than 24 CSS pixels across, so a symbol drawn only
  a few pixels wide still reads. Nothing is dimmed (ADR-1299, Mick, 2026-11-10: "I don't see the need for us to also change
  the colors on the map"): every territory keeps its own fill, and an island it rings nothing on looks as it does with no
  arc selected. A session's hover still dims the islands it holds none of.
- **Zoomed out to the wheel's floor:** the same capabilities' rings, since the territories show at every zoom
  (ADR-1272). The ring round a whole island that once stood here, at a far level, went with that level.
- Every ring's line is 3 CSS pixels wide at any zoom, redrawn as the eye zooms, as a claim's flag keeps its size.

A circle round the marker, not round the territory: a ring sized to the settlement never spills onto a neighbour, so no
ellipse fitted to the territory was needed. Where a capability's settlement stands right under its name, the name (drawn
over the map) covers part of its ring.

Pictures, 1440 x 960:

- `no-arc-selected.png`: the whole map, nothing drawn for open work.
- `no-arc-selected-the-library.png`: The library, near, nothing drawn for open work.
- `arc-selected.png`: the capability tree arc selected, the whole map: the capabilities ringed, nothing dimmed.
- `arc-selected-floor.png`: the same, zoomed out to the wheel's floor: the capabilities still ringed, nothing dimmed.
- `arc-selected-the-library.png`: The library, near: Library transactions ringed round its settlement.
- `arc-selected-the-arc-surface.png`: The arc surface, a small island, near (The forest above it): Arc surface, Story node
  render and Running sessions ringed.

Taken with `node --import tsx packages/forest/testing/view/open-work/capture.mjs --retake`, which also counts every ring and
dim shown from the scene into `measurements.json` (with an arc selected: five rings, no territory and no island dimmed). It
waits up to 30 minutes for every island's territory search to land (3.95).

In the evidence bucket for #519, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `519/no-arc-selected.png`, `519/no-arc-selected-the-library.png`, `519/arc-selected.png`, `519/arc-selected-far.png`, `519/arc-selected-the-library.png`, `519/arc-selected-the-arc-surface.png`, `519/before-dots-no-arc-selected-close.png`.

In the evidence bucket for #536, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `536/arc-selected-floor.png`, `536/arc-selected.png`, `536/arc-selected-the-arc-surface.png`, `536/arc-selected-the-library.png`, `536/no-arc-selected.png`, `536/no-arc-selected-the-library.png`.

In the evidence bucket for #671, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `671/before-sixth-run-dim-shades.png`, `671/arc-selected.png`, `671/arc-selected-floor.png`, `671/arc-selected-the-library.png`, `671/arc-selected-the-arc-surface.png`, `671/no-arc-selected.png`.
