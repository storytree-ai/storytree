# Story names stay put on their islands

Branch `claude/increment-5d7d3aa37fb9-9f0af4` (ADR-0917, superseding ADR-0855 D1; contracts 1.10 on Story nodes, 3.31 and 3.33
on Story node render). The owner, 2026-10-05: "As you rotate the globe it feels like the storynode labels move in a bid to stay
visible but i think this just makes the map more noisy." These are pictures for the owner to look at; nothing here is recorded
as accepted (ADR-0794).

| View | Before | After |
| --- | --- | --- |
| storytree's own globe as the app opens it | [before-storytree.png](before-storytree.png) | [after-storytree.png](after-storytree.png) |
| The same globe after the same quarter turn east, by a real pointer drag | [before-storytree-quarter-turn.png](before-storytree-quarter-turn.png) | [after-storytree-quarter-turn.png](after-storytree-quarter-turn.png) |
| Five stories depending on nothing: one row (1.10) | [before-row.png](before-row.png) | [after-row.png](after-row.png) |
| The same five in a chain (1.10) | [before-chain.png](before-chain.png) | [after-chain.png](after-chain.png) |
| The agent link selected and zoomed in: its capability names (3.33) | [before-agent-link-selected.png](before-agent-link-selected.png) | [after-agent-link-selected.png](after-agent-link-selected.png) |
| The website at 390 x 844, the shop's start-small cut (3.31) | [website-before-390-cut.png](website-before-390-cut.png) | [website-after-390-cut.png](website-after-390-cut.png) |
| The website at 1440 x 900, the same cut | [website-before-1440-cut.png](website-before-1440-cut.png) | [website-after-1440-cut.png](website-after-1440-cut.png) |

Measured in the page (`measurements-*.json`, `website-measurements-*.json`):

| View | Names shown, before | after | Overlapping pairs, after |
| --- | --- | --- | --- |
| storytree's own globe | 11 of 15 (The world hung behind the sphere) | 12 of 15 (the three others face away; none faded) | 0 |
| After the quarter turn | 8 of 15 | 9 of 15 | 0 |
| Row | 5 of 5 (by stepping) | 5 of 5 | 0 |
| Chain | 5 of 5 | 5 of 5 | 0 |
| The agent link's capabilities | 8 of 8 | 8 of 8 | 0 |
| Website, 390 px | 8 of 8 (by stepping) | 4 of 8 (Browsing fades under The cart; Accounts, Orders, Reviews, all dimmed, fade) | 0 |
| Website, 1440 px | 8 of 8 | 8 of 8 | 0 |

**Unmoved, measured.** For every name shown both before and after the quarter turn, with its island facing the eye at 0.2 or
more both times, the capture casts the ray through the name's top middle onto the surface its anchor lies on and reads where
it meets the island's own plate. Before, the names moved 17 to 93 ground units on their islands across the turn (The library
93, Process ledger 49, The librarian 41); after, 0 to 3 (pixel rounding).

What changed: a story's name is placed once, just south of its island's coast on the island's own plate, and turns with the
island; where two names overlap the less face-on fades (selected first, dimmed last), and a name under the Sessions strip fades;
a selected island's capability names fade the same way, the larger territory's winning; an unsurveyed story's progress sits
beneath its title, so its plate keeps 112 px and a first build's row of five shows every name. At the new land size The agent
link's capability names no longer overlap, so 3.33's fade shows in its test, not in this picture.

Judged against: **Plain language first** (a name reads like print on a map, in one place); the owner's "the labels on the map
are starting to feel noisy" (nothing on the map moves but the globe); **Observability-first** (every name on storytree's own
opening shows, none faded).

Renderer: headless Chromium, ANGLE / SwiftShader, dark theme, device scale 1. **Before** is `origin/main` (5c41fe17, ADR-0910's
spacing with ADR-0855's stepping) built from a throwaway worktree; **after** is this branch. The opening turn can differ by a
little between loads (increment_cd3f4ba29cb2), so before and after are each measured against their own opening.

## Rerun

`node --import tsx build.mjs <checkout> before|after`, then `node --import tsx capture.mjs before|after`; for the website,
`pnpm --filter @storytree/website build` in the checkout, then `node --import tsx website.mjs <checkout>/packages/website/dist before|after`.
Append `--retake` to replace the committed pictures; otherwise they go below `/tmp/storytree-captures`.
