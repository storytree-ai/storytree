# The story panel draws no capability tree; a capability is picked on the island (ADR-1285)

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. A road clicked falls
through to the capability's territory under it, which selects that capability: the island rings it in gold and the panel opens
on it. Then a gate clicked shows the links between its pair in the capability's place.

What this shows (contracts 4.6 and 4.8): the panel is the story's sentences and, below them, only the capability picked on the
island, with its word, its reason, its sentences, its health and its folded contracts. It has no tree, no card to click and no
"Open in a larger window" icon: the capture counts every `svg`, `.panel-tree`, `[data-open-tree]` and `[role="button"]` in the
panel, and finds none (on main before this change it found 18).

Pictures, 1440 x 960:

- `before-capability-panel.png`: the panel on main before the change, the same pick, with the tree's framed space between the
  sentences and the detail.
- `capability-picked-on-island.png`: the whole page after, Cloud connection (GCP) picked on The library and ringed in gold.
- `capability-picked-on-island-panel.png`: the panel alone after.
- `gate-picked-on-island-panel.png`: the panel after a gate is picked, its pair's links in the capability's place.

Taken with `node --import tsx packages/forest/testing/view/panel-picked-on-island/capture.mjs --retake`, which asserts that the
panel holds no tree and shows the capability the island ringed, and writes what it found into `measurements.json`.
