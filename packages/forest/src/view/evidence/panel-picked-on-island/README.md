# The story panel: a capability picked on the island, its detail behind folds a double-click opens (ADR-1285, ADR-1284 D1)

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. A road clicked falls
through to the capability's territory under it, which selects that capability: the island rings it in gold and the panel opens
on it. Then the Contracts handle is clicked once (nothing opens), double-clicked (it opens), and its first contract
double-clicked (it opens one level deeper). Then a gate clicked shows the links between its pair in the capability's place.

What this shows (contracts 4.6, 4.8 and 4.41): the panel is the story's lead and, below it, only the capability picked on the
island, with its word, its reason, its lead and its health; its contracts wait behind the handle "Contracts · 5", closed on the
first pick, and "Open all · 6" sits at the panel's foot. A single click on a handle opens nothing; a double-click opens it. It
has no tree, no card to click and no "Open in a larger window" icon: the capture counts every `svg`, `.panel-tree`,
`[data-open-tree]` and `[role="button"]` in the panel, and finds none.

Pictures, 1440 x 960:

- `before-folds-panel.png`: the panel on main before the folds, the same pick, its contracts behind a single-click "5 contracts".
- `capability-picked-on-island.png`: the whole page after, Cloud connection (GCP) picked on The library and ringed in gold.
- `capability-picked-on-island-panel.png`: the panel alone after, every fold closed.
- `capability-folds-opened-panel.png`: the panel after Contracts and its first contract are double-clicked open.
- `gate-picked-on-island-panel.png`: the panel after a gate is picked, its pair's links in the capability's place.

Taken with `node --import tsx packages/forest/testing/view/panel-picked-on-island/capture.mjs --retake`, which asserts that the
panel holds no tree, shows the capability the island ringed with every fold closed, that a single click opens nothing and a
double-click opens the fold, and writes what it found into `measurements.json`.

In the evidence bucket for the pull request that built the folds, linked from its body (ADR-1234; deleted after 90 days or when
its arc closes).
