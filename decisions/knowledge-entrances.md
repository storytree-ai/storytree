# Every story and capability has a shelf of front covers

- **Front cover of:** stories/library.md, capability 9
- **Full record:** ADR-0627 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0627`)

A decision can be the front cover of one story or capability, and artifacts link only to other artifacts.

So the only way from the work into the knowledge is through a front cover: the "rabbit hole" starts
at a story or a capability. A node may have many front covers, a shelf of them, so that entering a
large node does not flood an agent's context. Its shelf is every decision that names it, the
founding (oldest) book first.

The mark is one optional field on the decision, naming a single story or capability. One field names
one node, so no decision can be the cover of two, and nothing has to check for it. A decision, definition or other artifact kind may link to any other artifact, as often as it likes; a link from an artifact to any
work record is refused.

The library holds the data and these rules, so no writer, the agent link included, can go around
them. The forest's drill-down shows each shelf. The agent link's tools use the shelves: when an
agent names no place for a new artifact, they file it on the shelf of the capability it has claimed.

A story or capability created through storytree's tools starts with a short founding decision as its
first book, so shelves are not empty by design. The library still accepts a node with an empty shelf.

To replace a cover, the new decision becomes a cover of the same node and links to the old one, and
then the old one's mark is cleared, so it stays one step inside the new one. A revision that does not
change what was decided edits the decision in place. A cover is never simply retired, because
retiring does not check what links to it and would strand everything filed inside it.

Agents read spines first: opening a node shows each cover's title and first line, and opening a book
shows it whole, with the titles of what links in and out of it.

A decision about the whole project has no shelf of its own. It sits behind the covers that depend on
it, and a project-wide shelf can be added later if that proves awkward.

Only a small foundation had to land before the agent link's artifact tools: the cover field, the
artifacts-only rule and the shelf read. The rest is built when convenient.

ADR-0650 narrows D4: default filing covers every remaining artifact kind. A new artifact still
links to the cover the session last opened when it names no place; memories stay with the harness.
