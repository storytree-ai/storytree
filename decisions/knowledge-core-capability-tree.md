# The knowledge inside the planet: four capabilities, a graph that refuses loops, built alongside the MVP

- **Front cover of:** stories/knowledge-core.md
- **Full record:** ADR-0647 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0647`)

The knowledge core is a story of its own with four capabilities, built in this order: earlier decisions beside their replacements, knowledge under its shelves, reads by session and agent, and a deliberate "Look inside" view.

The owner approved the tree on 2026-09-27 with the question's recommendations: A1, D1, G2, R1, T1,
V1, S1 and E1. Depth is the longest chain of stored references down from the shelves, and an artifact
no shelf reaches orbits outside. Ghosts come from the decision log's supersession, plus an
"earlier cover" found in write history. Reads come from the agent link's existing activity log,
and full reads replay as jumps because the record names no source artifact.

For loops he chose L3: the knowledge graph is a DAG and the library refuses a link that would close
a loop. If a loop is ever needed, that is a discussion with him before it happens. The refusal is
the library's own work; until it lands, the core draws any loop it meets as a labelled error.

He also directed the core built now, in parallel with the MVP, and iterated on later. That retires
ADR-0629 D3's ranking below every MVP increment, for the core.

ADR-0650 removes the library memory type and calls knowledge records artifacts. Depth still follows
what artifacts rest on; harness memories do not add a second containment rule.
