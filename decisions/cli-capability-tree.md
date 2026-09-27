# The command line is a front door onto the library and the agent link: ten capabilities, writes recorded by writer, friction and plan verbs, no anchors yet

- **Front cover of:** stories/cli.md
- **Full record:** ADR-0645 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0645`)

`storytree` is the command a person types in a terminal to read and change their project's records, and it keeps no rule of its own.

Each command is handed to the function its owning story already has: the library for records, work,
questions and decisions, and the agent link for project routing, claims, the setup check and
friction capture. So the command line and the agent's tools can never disagree.

The ten capabilities are Front door, Who wrote it, Library, Arcs and increments, Questions,
Decisions, the Board (read only), Doctor, Friction and re-steers, and the Plan view (`storytree
tree`). The owner approved the tree with "T1 as recommended":

- W1: the library keeps an optional writer on every write, and the command line passes the person.
- A1: a write run inside an agent session is recorded as that session, and the command says so.
- F1 and P1: friction and re-steers, and the plan view, are in.
- V1: decision anchors and `adr rebind` wait until after the MVP.
- M1: three of ADR-0643's leave-outs are re-measured by their lanes, subagent transcripts counted.

Left out, because they did not last in 0.2 (ADR-0639): `library repoint`, `library --check`,
`library artifact retire`, `arc increment ready`, `adr next`, `adr attest`, `adr show`, `noticeboard
history` and `mine`, the `--pg` switch, credential hydration and `doctor --dev`. Claiming and
releasing stay with the agent tools, and an arc's state is worked out, so there is no `arc close`.

It asks two lanes for small additions first: a writer and `get`, `list` and `history` on the
library's public API, and a claims reading, the setup check outside a session and a `reinforce`
capture function from the agent link.
