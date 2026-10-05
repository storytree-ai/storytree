# The globe reads in depth (ADR-0919)

Before and after, side by side, on the actual desktop page: the traversal capture's eight-story seed and survey, its
one running session selected, at 1440 × 960 with reduced motion. "Before" bundles the four changed files as they were
at the increment's base commit (`c8018334`); "after" is this landing. The land is brown because the seed carries no
verified health.

| View | What changed |
| --- | --- |
| [1 · opening](sheet-1-opening.png) | Lines and core notes behind the facing islands are no longer drawn over them; lines over the sea stay. |
| [2 · close on the agent link](sheet-2-agent-link-close.png) | A dive passing behind the island now stops at its coast, and the two notes beneath it are hidden (D2). |
| [3 · the forest's hop](sheet-3-forest-hop.png) | Hops arcing above the land stay in front. |
| [4 · behind the knowledge core's island](sheet-4-behind-the-core-island.png) | The far side's islands, roads and hops are gone; the core's notes and two dives remain (D1). |
| [5 · behind the forest](sheet-5-behind-the-forest.png) | The same, from another side. |
| [6 · zoomed past the islands](sheet-6-zoomed-past-the-islands.png) | At framing 0.1 the islands and their marks are hidden, leaving the glass and core (D3). |
| [7 · zoomed back out](sheet-7-zoomed-back-out.png) | At 0.5 they are back. |
| [8 · Library](sheet-8-library.png) | The glass now stays, with the core inside it (D4). |

[measurements.json](measurements.json) counts, for each view, the island grounds shown, the depth layers and the
glass's far face: after, every island has a depth layer and the far face is opaque and writes depth; grounds are
hidden only zoomed past the islands and in the Library; no page errors.

The website's tour shares the globe. [website-knowledge-steps.png](website-knowledge-steps.png) shows its two
knowledge steps before, after and the changed pixels, from a one-off build of the website page at 1440 × 960, reduced
motion, the tour paused. In "What the project knows lives inside" (island grounds over the core), the notes under
each facing island are now hidden, about 27% of the visible dots; the core still reads in the open sea between the
islands. In "Different notes do different jobs" (the knowledge panel, which puts the globe in Library mode) the glass
now stays, as D4 decides, so the step keeps the ball the step before it showed.

Rerun from the checkout root with `node --import tsx packages/forest/src/view/evidence/depth/capture.mjs`
(scratch output; `--retake` writes here). `BEFORE=<ref>` compares against another commit.
