# Knowledge beneath the islands, with loose artifacts at the core

- **Front cover of:** stories/knowledge-core.md, capability 1
- **Full record:** ADR-0658 in storytree 0.2's decision log, storytree-ai/storytree02 (`pnpm storytree library artifact adr-0658`)

Accepted on 2026-09-27 by the owner's option selections after the look test
`spike/globe-knowledge`: faint points beneath each island, no threads, and artifacts
reached from no shelf pooled at the centre. These are selections, not quotations.

Each shelf-placed artifact appears once beneath its home island at capability 1's
computed depth. The existing shelf directions, sibling spread and depth spacing are
shared by the globe and the retained inspection implementation. No-shelf artifacts
keep their lack of depth and use a small cluster at 0.04 globe radii; none orbit outside.
Points use the selected look's muted blue-grey, opacity 0.52 and radius 0.006 globe
radii. They do not write depth or intercept raycasts. There are no threads, ghosts,
read colours or replay controls in this layer.

The forest composes `KnowledgeGlobePoints` through `@storytree/knowledge-core/view`
in the globe's existing inside slot. Knowledge placement and the live subscription
stay in the knowledge-core package. The visible islands, names, markers, pathways,
selection and failure navigation retain their existing drawing and behaviour.

This narrows ADR-0655 D2's calculations-only clause and ADR-0647 D1's outside placement
on the globe. The separate Look-inside view stays unmounted. The
[seeded front and quarter-turn evidence](../packages/forest/src/view/evidence/knowledge-under-islands/README.md)
records the actual seed census and renderer; the earlier look measured 73 shelf-placed
and five no-shelf artifacts, all placed artifacts at depth 1.
