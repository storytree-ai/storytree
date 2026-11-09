# The story panel shows exactly what is selected: a capability picked on the island, the story alone with its capabilities by name, and a picked gate's links (ADR-1297, ADR-1285, ADR-1287, ADR-1284 D4)

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. A road clicked falls
through to the capability's territory under it, which selects that capability: the island rings it in gold and the panel opens
on it. Then the story's name above its title is clicked, which opens the story alone; then the first capability's name in the
story's list is clicked (the snapshot predates "Connection by address", so the capture takes the first name when that one is
not there), which opens that capability and rings it on the island, and its first contract is clicked open. Then a gate
clicked shows the links between its pair, its Contracts handle is clicked open, and its first contract clicked (it opens one
level deeper, as a capability's does). The capture's clicks on the map skip any point the open panel covers.

The snapshot predates edge records (ADR-1279), so the capture stages The library's links: one for every pair of its
capabilities a gate may join, said by its recorded dependency where it has one, each with the same two made-up contracts
("Reads the other only through its exported functions, never its tables", "Names each record it hands over by its id"),
the first staged as last seen failing and the second passing, every third with none. No arc is opened in the Arcs tab, so
no link says "open work on this link" here; contract 2.50 and 4.40's tests pin that.

What this shows (contracts 4.6, 4.7, 4.8, 4.40 and 4.41, ADR-1297): a capability picked heads the panel with its title, its
story named small above it, the why line when it needs the user, its whole description, then its contracts, each with its
own state on show ("storytree saw: passing", or the agent's report where storytree saw nothing); there is no "How it works"
fold, no word and no Health fold (its territory carries its health), and nothing of the story's description or list. The
story alone shows its whole description, "1 capability needs you", and its fourteen capabilities by name, with none picked
and none ringed on the island. A name opens its capability, ringed in gold. The panel has no tree, no card and no "Open in
a larger window" icon: the capture counts every `svg`, `.panel-tree`, `[data-open-tree]` and `[role="button"]` in the panel,
and finds none. A picked gate (contract 4.40, ADR-1284 D4) shows the story's title, then each link's sentence and its state
in one line, "Contracts · 2" and, in red, "1 failing", its contracts closed behind that handle until a click opens them.

Pictures, 1440 x 960:

- `capability-picked-on-island.png`: the whole page, Cloud connection (GCP) picked on The library and ringed in gold.
- `capability-picked-on-island-panel.png`: its panel. Before this change (#631's `capability-folds-opened-panel.png`) the
  panel led with the story's lead and showed the capability below it with its word, a "How it works" fold, a Health fold
  and its contracts behind "Contracts · 5".
- `story-alone-panel.png`: the story alone, opened by its name above the capability's title: its whole description and its
  capabilities by name, nothing picked.
- `capability-picked-by-name-panel.png`: the first name clicked, Project libraries, with its first contract opened.
- `gate-picked-on-island-panel.png`: the panel after a gate is picked: the story's title, its link's sentence and state line,
  "Contracts · 2" closed, then "1 failing".
- `gate-contracts-opened-panel.png`: the same after "Contracts · 2" is clicked open, each contract with its state.
- `gate-contract-opened-panel.png`: the same after its first contract is clicked open: the agent's report and its trail,
  storytree's verdict on its handle, as a capability's contract shows (contract 4.40).

Taken with `node --import tsx packages/forest/testing/view/panel-picked-on-island/capture.mjs --retake`, which asserts that the
panel holds no tree; that a capability picked on the island heads the panel with its story above it, no How it works, Health
or Contracts fold and a state on every contract; that the story's name opens the story alone with every capability named and
none picked or ringed; that a name opens its capability, ringed; that one click opens a contract; that each of a picked gate's
links says its state in one line with how many are failing and its contracts closed; and writes what it found into
`measurements.json`.

In the evidence bucket for #610, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): #607's `607/before-folds-panel.png` and `607/gate-picked-on-island-panel.png` (the before), `610/capability-picked-on-island.png`, `610/capability-picked-on-island-panel.png`, `610/capability-folds-opened-panel.png`, `610/gate-picked-on-island-panel.png`, `610/gate-contracts-opened-panel.png`.

In the evidence bucket for #610, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `610/capability-picked-on-island.png`, `610/capability-picked-on-island-panel.png`, `610/capability-folds-opened-panel.png`, `610/gate-picked-on-island-panel.png`, `610/gate-contracts-opened-panel.png`.

In the evidence bucket for #612, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `612/gate-picked-on-island-panel.png`, `612/gate-contracts-opened-panel.png`.

In the evidence bucket for #625, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `625/gate-contract-opened-panel.png`, `625/capability-folds-opened-panel.png`, `625/gate-contracts-opened-panel.png`, `625/gate-picked-on-island-panel.png`.

In the evidence bucket for #631, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `631/capability-folds-opened-panel.png`, `631/gate-contracts-opened-panel.png`, `631/gate-contract-opened-panel.png`.

In the evidence bucket for #662, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `662/capability-picked-on-island.png`, `662/capability-picked-on-island-panel.png`, `662/story-alone-panel.png`, `662/capability-picked-by-name-panel.png`, `662/gate-picked-on-island-panel.png`, `662/gate-contracts-opened-panel.png`, `662/gate-contract-opened-panel.png`.
