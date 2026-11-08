# The story panel: a capability picked on the island, its detail behind folds a double-click opens, and a picked gate's links each in a line (ADR-1285, ADR-1284 D1, D4)

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. A road clicked falls
through to the capability's territory under it, which selects that capability: the island rings it in gold and the panel opens
on it. Then the Contracts handle is clicked once (nothing opens), double-clicked (it opens), and its first contract
double-clicked (it opens one level deeper). Then Escape on the panel forgets the kept depth, a gate clicked shows the links
between its pair in the capability's place, its Contracts handle is double-clicked open, and its first contract
double-clicked (it opens one level deeper, as a capability's does).

The snapshot predates edge records (ADR-1279), so the capture stages The library's links: one for every pair of its
capabilities a gate may join, said by its recorded dependency where it has one, each with the same two made-up contracts
("Reads the other only through its exported functions, never its tables", "Names each record it hands over by its id"),
the first staged as last seen failing and the second passing, every third with none. No arc is opened in the Arcs tab, so
no link says "open work on this link" here; contract 2.50 and 4.40's tests pin that.

What this shows (contracts 4.6, 4.8 and 4.41): the panel is the story's lead and, below it, only the capability picked on the
island, with its word, its reason, its lead and its health; its contracts wait behind the handle "Contracts · 5", closed on the
first pick, and "Open all · 6" sits at the panel's foot. A single click on a handle opens nothing; a double-click opens it. It
has no tree, no card to click and no "Open in a larger window" icon: the capture counts every `svg`, `.panel-tree`,
`[data-open-tree]` and `[role="button"]` in the panel, and finds none. A picked gate (contract 4.40, ADR-1284 D4) says
each link's sentence, "7 · Library API depends on 11 · Waits.", then its state in one line, "Contracts · 2" and, in red,
"1 failing" (how many of the link's contracts storytree last saw failing, edge contracts carrying their own health in the
annotated tree, contract 5.22), its contracts closed behind that handle until a double-click opens them.

Pictures, 1440 x 960:

- `before-folds-panel.png`: the panel on main before the folds, the same pick, its contracts behind a single-click "5 contracts".
- `capability-picked-on-island.png`: the whole page after, Cloud connection (GCP) picked on The library and ringed in gold.
- `capability-picked-on-island-panel.png`: the panel alone after, every fold closed.
- `capability-folds-opened-panel.png`: the panel after Contracts and its first contract are double-clicked open.
- `gate-picked-on-island-panel.png`: the panel after a gate is picked: its link's sentence and state line, "Contracts · 2"
  closed, then "1 failing". Before this change (#610's picture of the same name) the line said "Contracts · 2" alone, edge
  contracts carrying no health.
- `gate-contracts-opened-panel.png`: the same after "Contracts · 2" is double-clicked open.
- `gate-contract-opened-panel.png`: the same after its first contract is double-clicked open: the agent's report, its trail
  and storytree's verdict, the same lines as a capability's contract in `capability-folds-opened-panel.png` and nothing
  more (contract 4.40, ADR-1289). Before this change (#612's `gate-contracts-opened-panel.png`) each contract was a plain
  line with no handle.

The capability pictures are unchanged in look from #610's; only the gate's two are taken again for #612.

Taken with `node --import tsx packages/forest/testing/view/panel-picked-on-island/capture.mjs --retake`, which asserts that the
panel holds no tree, shows the capability the island ringed with every fold closed, that a single click opens nothing and a
double-click opens the fold, that each of a picked gate's links says its state in one line with how many are failing and its
contracts closed, and writes what it found into `measurements.json`.

In the evidence bucket for #610, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): #607's `607/before-folds-panel.png` and `607/gate-picked-on-island-panel.png` (the before), `610/capability-picked-on-island.png`, `610/capability-picked-on-island-panel.png`, `610/capability-folds-opened-panel.png`, `610/gate-picked-on-island-panel.png`, `610/gate-contracts-opened-panel.png`.

In the evidence bucket for #610, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `610/capability-picked-on-island.png`, `610/capability-picked-on-island-panel.png`, `610/capability-folds-opened-panel.png`, `610/gate-picked-on-island-panel.png`, `610/gate-contracts-opened-panel.png`.

In the evidence bucket for #612, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `612/gate-picked-on-island-panel.png`, `612/gate-contracts-opened-panel.png`.

In the evidence bucket for #625, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `625/gate-contract-opened-panel.png`, `625/capability-folds-opened-panel.png`, `625/gate-contracts-opened-panel.png`, `625/gate-picked-on-island-panel.png`.
