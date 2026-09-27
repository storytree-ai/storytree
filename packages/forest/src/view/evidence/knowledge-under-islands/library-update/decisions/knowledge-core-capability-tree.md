# The knowledge inside the planet: four capabilities, a graph that refuses loops, built alongside the MVP

- **Front cover of:** stories/knowledge-core.md
- **Full record:** ADR-0647 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0647`)

The knowledge core is a story of its own with four capabilities, built in this order: earlier decisions beside their replacements, knowledge under its shelves, reads by session and agent, and a deliberate "Look inside" view.

**Narrowed in place, 2026-09-27 (ADR-0655 D2).** The owner said there is no need for
"Look inside" yet. Its implementation has already landed, but the page entry is now removed;
capabilities 1 to 3 remained as calculations. **Further narrowed by ADR-0658 (2026-09-27):**
capability 1's placements show on the globe as faint points, with loose artifacts pooled
at its centre. Look inside stays unmounted; ghosts and reads remain calculations.
See [the globe-only decision](globe-only-and-room-for-pathways.md).

The owner approved the tree on 2026-09-27 with the question's recommendations: A1, D1, G2, R1, T1,
V1, S1 and E1. Depth is the longest chain of stored references down from the shelves, and an artifact
no shelf reaches has no depth. ADR-0658 replaces its outside orbit on the globe with a small
centre cluster; the retained, unmounted inspection view still uses the earlier orbit.
See [the knowledge layer](knowledge-under-islands.md). Ghosts come from the decision log's supersession, plus an
"earlier cover" found in write history. Reads come from the agent link's existing activity log,
and full reads replay as jumps because the record names no source artifact.

For loops he chose L3: the knowledge graph is a DAG and the library refuses a link that would close
a loop. If a loop is ever needed, that is a discussion with him before it happens. The refusal is
the library's own work, landed in storytree-ai/storytree#87. The retained inspection view
draws any older stored loop it meets as a labelled error; the globe's faint-point layer
does not add loop inspection.

He also directed the core built now, in parallel with the MVP, and iterated on later. That retires
ADR-0629 D3's ranking below every MVP increment, for the core.

ADR-0650 removes the library memory type and calls knowledge records artifacts. Depth still follows
what artifacts rest on; harness memories do not add a second containment rule.
