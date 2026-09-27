# The library's revised tree: eight more knowledge kinds, work in flight, waits, owner questions and the decision log

- **Front cover of:** stories/library.md
- **Full record:** ADR-0640 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0640`)

The library keeps its nine capabilities; the knowledge artifacts capability grows by eight kinds, and four are added, thirteen in all.

The eight kinds are principles, guardrails, patterns, processes, agent roles, friction, re-steers and
tech stack, each with 0.2's fields. The four new capabilities are work in flight (each arc whole,
with its increments), waits (an arc on an arc, an increment on an increment), the owner's questions,
and the decision log (numbers, status, supersession, the load-bearing mark, who decided, and a
composed statement).

They are what ADR-0633 brought back from 0.2 and routed to the library. The owner approved the tree
with four choices of his own:

- N1: the `storytree` project's decision numbers continue after 0.2's highest, so an ADR number
  means one thing across both generations. Every other project starts at 1.
- P1: no plan anchor on increments, no `increment check` and no running planner agent, because they
  did not last in 0.2 (ADR-0639). Planning stays, written in the increment's body.
- C2: composed statements for decisions come now, one maintained paragraph that never replaces the
  decision's text.
- R1: no hand re-open of an arc. An arc re-opens when work is parked on it.

Two record shapes change: an arc gains a required intent and end state, and a decision a required
status. Each gets its first upgrade step, so every older record carries over untouched.

The build order is the eight kinds and work in flight first, then waits and questions, then the
decision log. Each is red then green against the in-memory twin and Postgres.

The library stores these records and alone answers whether a wait holds and whether an increment is
waiting on the owner. The arc surface only reads them, the agent link's claims stay in its own
activity log, and the one-copy lane and the librarian use the records and the number allocator.

ADR-0650 narrows capability 6: there is no library memory type; knowledge records are artifacts.
