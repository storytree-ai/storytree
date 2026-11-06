# Picking a gate rings the gate, not the road (contract 3.88)

Mick, 2026-11-05, after clicking a gate on The library: "when i select a gate i would of assumed that gate covers the
contracts between both capabilities going both ways, in the image here seems like the road highlights, which isn't
really what i want, the gate should show the circle when i select this".

The real desktop page on storytree's own map (the code-rows snapshot and its survey), close up on The library, each pick
a mouse click on the canvas that the map's own pointer handler takes.

What this step draws:

- **A gate picked:** a hollow gold ring round its two posts, the same ring the selected arc's open work wears (3.83), in
  the pick's gold. Its line is 3 CSS pixels wide at any zoom and it is never less than 24 pixels across. No road segment
  and no gate face is lit. The click also selects The library with the gate's two sides (here Library transactions and
  its neighbour) on the panel's selection. What the panel lists for that pair is a later increment's (held on the
  question about rings on interfaces).
- **A road picked:** as before (3.81), its whole way lit in gold and its entrance gate's faces, and no ring.

Pictures, 1440 x 960:

- `the-library-nothing-picked.png`: The library, near, nothing picked.
- `the-library-gate-picked.png`: a gate between two capabilities clicked: its ring, no road lit.
- `the-library-road-picked.png`: a road carrying one link clicked: its way in gold, no ring.
- `the-library-gate-picked-close.png`: closer, a gate clicked: the ring round its posts.

Taken with `node --import tsx packages/forest/testing/view/gate-ring/capture.mjs --retake`, which counts every gate ring,
lit road and gold gate face shown, from the scene, into `measurements.json`.

In the evidence bucket for #534, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `534/the-library-gate-picked-close.png`, `534/the-library-gate-picked.png`, `534/the-library-nothing-picked.png`, `534/the-library-road-picked.png`.
