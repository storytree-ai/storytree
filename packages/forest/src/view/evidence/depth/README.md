# The globe reads in depth (ADR-0919)

Before and after, side by side, on the actual desktop page: the traversal capture's eight-story seed and survey, its
one running session selected, at 1440 × 960 with reduced motion. "Before" bundles the four changed files as they were
at the increment's base commit (`c8018334`); "after" is this landing. The land is brown because the seed carries no
verified health.

| View | What changed |
| --- | --- |
| [1 · opening](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-1-opening.png) | Lines and core notes behind the facing islands are no longer drawn over them; lines over the sea stay. |
| [2 · close on the agent link](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-2-agent-link-close.png) | A dive passing behind the island now stops at its coast, and the two notes beneath it are hidden (D2). |
| [3 · the forest's hop](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-3-forest-hop.png) | Hops arcing above the land stay in front. |
| [4 · behind the knowledge core's island](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-4-behind-the-core-island.png) | The far side's islands, roads and hops are gone; the core's notes and two dives remain (D1). |
| [5 · behind the forest](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-5-behind-the-forest.png) | The same, from another side. |
| [6 · zoomed past the islands](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-6-zoomed-past-the-islands.png) | At framing 0.1 the islands and their marks are hidden, leaving the glass and core (D3). |
| [7 · zoomed back out](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-7-zoomed-back-out.png) | At 0.5 they are back. |
| [8 · Library](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/sheet-8-library.png) | The glass now stays, with the core inside it (D4). |

[measurements.json](measurements.json) counts, for each view, the island grounds shown, the depth layers and the
glass's far face: after, every island has a depth layer and the far face is opaque and writes depth; grounds are
hidden only zoomed past the islands and in the Library; no page errors.

The website's tour shares the globe. [website-knowledge-steps.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth/website-knowledge-steps.png) shows its two
knowledge steps before, after and the changed pixels, from a one-off build of the website page at 1440 × 960, reduced
motion, the tour paused. In "What the project knows lives inside" (island grounds over the core), the notes under
each facing island are now hidden, about 27% of the visible dots; the core still reads in the open sea between the
islands. In "Different notes do different jobs" (the knowledge panel, which puts the globe in Library mode) the glass
now stays, as D4 decides, so the step keeps the ball the step before it showed.

Rerun from the checkout root with `node --import tsx packages/forest/src/view/evidence/depth/capture.mjs`
(scratch output; `--retake` writes here). `BEFORE=<ref>` compares against another commit.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 9 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/depth).
