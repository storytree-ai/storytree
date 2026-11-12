# Selecting an arc says how many parts and links it rings (contract 3.108)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), with the open-work capture's active arc
in the stand-in bridge: its open increments name five capabilities of the seed (a closed increment's is left out) and link no
contract.

What this step shows: with the arc's row clicked in the Arcs tab, the map's top row, after the face switches and the layout
mark, reads "The arc's open work rings 5 parts and no link.", in the rings' pale cyan, left of the compass. It counts the rings
across the whole map, so it reads the same while islands are still laid out and their rings not yet drawn, or when a ringed
part is off screen. With no arc selected there is no count.

Pictures, 1440 x 960:

- `no-arc-selected.png`: the whole page, no count in the top row.
- `arc-selected.png`: the whole page, the arc selected, the count in the top row.
- `arc-selected-top-row.png`: the top row alone, cropped from the same page.

Taken with `node --import tsx packages/forest/testing/view/open-work-count/capture.mjs --retake`, which asserts the count's
words with and without the arc selected and writes them into `measurements.json`.
