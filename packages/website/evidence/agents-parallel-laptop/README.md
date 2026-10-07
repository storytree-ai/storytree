# The parallel step's islands on a laptop (increment_8950842c647b, contract 2.18)

**Before** (`before/`, main at 85392207) and **after** (`after/`) at 1920×1080, 1440×900, 1280×800, 390×844 and 320×700,
each step of the agents chapter played in order, so the parallel step is reached from the claim step as a visitor reaches
it. They are made from the locally built site by
`node packages/website/evidence/arrival/capture.mjs --only agents --to agents-parallel-laptop/after`.

| | Before | After |
|---|---|---|
| Parallel step, 1280 | Browsing and the cart on the sessions list's top edge; their names under the list | Checkout, the cart and Browsing stand above the list, each name and tag whole (`after/1280-agents-parallel.png`) |
| Parallel step, 1440 | The cart's name under the list's top edge, Browsing under the list | All three clear of the list (`after/1440-agents-parallel.png`) |
| Parallel step, 1920 | Browsing's name under the list | All three clear of the list (`after/1920-agents-parallel.png`) |
| Phones, 390 and 320 | — | Unchanged: the parallel step matches its before pixel for pixel. The 320 stand-down's tag took the left side in this run, not the right; that step's camera is the same on a phone, and the tag reads whole either way |

**See:** on a laptop the three sessions' islands, their names and their tags all stand above the sessions list.
**Feel:** settled: nothing the step talks about is tucked under a panel.
**Think:** "three islands, three sessions, the same three rows", which is the step's point.

How:
- The parallel step aimed at no island, so the camera kept whatever turn the step before it left: reached from the claim
  step (aimed at checkout) the three islands ran down onto the sessions list. On a laptop it now aims at Browsing, the
  lowest of the three, at framing 1.2, so the view is the same whichever step came before (`src/tour-copy.ts`; a step's
  `laptop` view in `src/tour.ts`, used above 600px by `src/forest-scene.tsx`).
- A phone keeps the overview at 1.05. Aiming a phone at Browsing would lift Checkout's tag under the phone's sessions list,
  which sits at the top of the screen.

Checks:
- The browser journey `--verify-immersive` (`evidence/tour.mjs`, 2.18) now also checks, on a laptop, that each tagged
  island's own name is shown and clear of the card and the panels on the claim and parallel steps. Red on main at 1440 (the
  cart's name under the sessions list), green at 1920, 1440 and 1280 in three runs on this branch.
- The same journey fails at 390 on main and on this branch alike: on the parallel step, Part 2's tag clips the cart's ring by
  about 4px. That is the phone's tag placement, unchanged here, and is parked on the arc with the phone's own name
  overlaps (Browsing's name under the card, the tags over Checkout's and the cart's names).
