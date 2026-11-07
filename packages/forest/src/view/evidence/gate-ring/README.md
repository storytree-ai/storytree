# Picking a gate rings the gate; a road takes no click, and a selected capability is ringed (contracts 3.88, 3.15, 3.91)

Mick, 2026-11-05, after clicking a gate on The library: "when i select a gate i would of assumed that gate covers the
contracts between both capabilities going both ways, in the image here seems like the road highlights, which isn't
really what i want, the gate should show the circle when i select this". And 2026-11-07, by voice: "I don't think we
should ever have highlighting or selection of the roads, because we have the gates. I do believe everything else should
be selectable. Sometimes I am able to select the capability itself, though no blue circle appears over it".

The real desktop page on storytree's own map (the code-rows snapshot and its survey), close up on The library, each pick
a mouse click on the canvas that the map's own pointer handler takes.

What this step draws:

- **A gate picked:** a hollow gold ring round its two posts, the same ring the selected arc's open work wears (3.83), in
  the pick's gold. Its line is 3 CSS pixels wide at any zoom and it is never less than 24 pixels across. No road segment
  and no gate face is lit. The click also selects The library with the gate's two sides (here Library transactions and
  its neighbour) on the panel's selection. What the panel lists for that pair is a later increment's (held on the
  question about rings on interfaces).
- **A road clicked:** the road takes no click (3.81 is retired): the click lands on the capability's territory under it,
  which is selected (3.15) and ringed (3.91). Nothing is lit gold and no gate is ringed.
- **A selected capability:** a hollow ring round its settlement, the same mark as the gate's, in the pick's gold, outside
  where an open-work ring would stand and never less than 36 pixels across. Blue keeps meaning an arc's open work: beside
  an arc's blue ring the picked capability's ring reads gold.

Pictures, 1440 x 960:

- `the-library-nothing-picked.png`: The library, near, nothing picked.
- `the-library-gate-picked.png`: a gate between two capabilities clicked: its ring, no road lit.
- `the-library-road-clicked.png`: a road carrying one link clicked: the capability under it (Library API) selected,
  ringed in gold and shown in the panel; no road lit, no gate ringed.
- `the-library-road-clicked-beside-an-arc.png`: an arc selected whose open work names Library transactions (its blue
  ring), then the same road clicked: Library API's gold ring beside it.
- `the-library-gate-picked-close.png`: closer, a gate clicked: the ring round its posts.

Taken with `node --import tsx packages/forest/testing/view/gate-ring/capture.mjs --retake`, which counts every gate ring,
selected capability's ring, open-work ring, lit road and gold gate face shown, from the scene, into `measurements.json`.

In the evidence bucket for #534, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `534/the-library-gate-picked-close.png`, `534/the-library-gate-picked.png`, `534/the-library-nothing-picked.png`, `534/the-library-road-picked.png` (the retired road pick).
