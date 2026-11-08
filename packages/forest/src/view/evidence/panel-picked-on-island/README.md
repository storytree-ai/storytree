# The story panel: a capability picked on the island, its detail behind folds a double-click opens, and a picked gate's links each in a line (ADR-1285, ADR-1284 D1, D4)

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. A road clicked falls
through to the capability's territory under it, which selects that capability: the island rings it in gold and the panel opens
on it. Then the Contracts handle is clicked once (nothing opens), double-clicked (it opens), and its first contract
double-clicked (it opens one level deeper). Then Escape on the panel forgets the kept depth, a gate clicked shows the links
between its pair in the capability's place, and its Contracts handle is double-clicked open.

The snapshot predates edge records (ADR-1279), so the capture stages The library's links: one for every pair of its
capabilities a gate may join, said by its recorded dependency where it has one, each with the same two made-up contracts
("Reads the other only through its exported functions, never its tables", "Names each record it hands over by its id"),
every third with none. No arc is opened in the Arcs tab, so no link says "open work on this link" here; contract 2.50 and
4.40's tests pin that.

What this shows (contracts 4.6, 4.8 and 4.41): the panel is the story's lead and, below it, only the capability picked on the
island, with its word, its reason, its lead and its health; its contracts wait behind the handle "Contracts · 5", closed on the
first pick, and "Open all · 6" sits at the panel's foot. A single click on a handle opens nothing; a double-click opens it. It
has no tree, no card to click and no "Open in a larger window" icon: the capture counts every `svg`, `.panel-tree`,
`[data-open-tree]` and `[role="button"]` in the panel, and finds none. A picked gate (contract 4.40, ADR-1284 D4) says
each link's sentence, "7 · Library API depends on 11 · Waits.", then its state in one line, "Contracts · 2", its contracts
closed behind that handle until a double-click opens them.

Pictures, 1440 x 960:

- `before-folds-panel.png`: the panel on main before the folds, the same pick, its contracts behind a single-click "5 contracts".
- `capability-picked-on-island.png`: the whole page after, Cloud connection (GCP) picked on The library and ringed in gold.
- `capability-picked-on-island-panel.png`: the panel alone after, every fold closed.
- `capability-folds-opened-panel.png`: the panel after Contracts and its first contract are double-clicked open.
- `gate-picked-on-island-panel.png`: the panel after a gate is picked: its link's sentence and state line, "Contracts · 2"
  closed. Before this change (#607's picture of the same name) the gate said only "No link joins these two capabilities
  directly.", the snapshot having no links; on main a link listed every contract at once, with no handle.
- `gate-contracts-opened-panel.png`: the same after "Contracts · 2" is double-clicked open.

Taken with `node --import tsx packages/forest/testing/view/panel-picked-on-island/capture.mjs --retake`, which asserts that the
panel holds no tree, shows the capability the island ringed with every fold closed, that a single click opens nothing and a
double-click opens the fold, that each of a picked gate's links says its state in one line with its contracts closed, and
writes what it found into `measurements.json`.

In the evidence bucket for #PR, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `PR/before-folds-panel.png` (#607's), `PR/capability-picked-on-island.png`, `PR/capability-picked-on-island-panel.png`, `PR/capability-folds-opened-panel.png`, `PR/gate-picked-on-island-panel.png`, `PR/gate-contracts-opened-panel.png`.
