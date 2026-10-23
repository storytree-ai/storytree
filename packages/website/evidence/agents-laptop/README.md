# The agents chapter's tags on a laptop (increment_d9d744221102, contract 2.18)

**Before** (`before/`, main at 3a18bbb4) and **after** (`after/`) at 1920×1080, 1440×900, 1280×800, 390×844 and 320×700,
each step of the agents chapter on the shop's recorded moments, played in order with motion as a visitor sees them. They
are made from the locally built site by
`node packages/website/evidence/arrival/capture.mjs --only agents --to agents-laptop/after`.

| | Before | After |
|---|---|---|
| Parallel step, 1440 | 'Part 2: Browsin' ran into 'Part 3: cart page and menu', both over the cart's ring and the Browsing and The cart names | Part 2's tag sits left of Browsing, Part 3's right of the cart, Part 4's right of Checkout: all three whole (`after/1440-agents-parallel.png`) |
| Parallel step, 1920 | 'Part 2: Browsing' sat over the cart's ring, touching Part 3's tag | Part 2 left, Part 3 right, Part 4 right (`after/1920-agents-parallel.png`) |
| Parallel step, 1280 | 'Part 2: Browsi' cut by Part 3's tag; both on the sessions list's edge | Browsing and the cart sit on the sessions list's top edge here, so Part 2's and Part 3's tags go above their rings, side by side, flush with each ring's edge (`after/1280-agents-parallel.png`) |
| Claim step, 1440 | The cart's tag sat left of its ring, over the Browsing island | Right of the cart, clear of Browsing (`after/1440-agents-claim.png`) |
| Phones, 390 and 320 | — | Unchanged: every phone picture matches its before pixel for pixel, but for render noise in the 390 stand-down (58 px, no tag moved) |

**See:** on a laptop the three claimed islands each carry their session's name, readable in full, none on top of another.
**Feel:** composed: the names sit where the eye expects them, beside each island.
**Think:** "three sessions, three islands, at once", which is the step's point.

How:
- `src/forest-scene.tsx`: a laptop now places its tags with `placeTags` as a phone does, clear of the other names, the other
  rings, the islands' names, the card, the sessions list and the arcs drawer (before, a laptop placed each tag alone: right,
  or left where the right had no room, blind to the others). A laptop takes the first clear side every frame instead of
  keeping its last one, so a side chosen while the arcs drawer slid in is not kept once it has gone.
- `src/tour.ts` `placeTags`, with `share` (laptops only): a side counts as clear allowing for rounding (a ring between pixels
  once left the right side at −0.00000000001, so the claim step's tag went left); and when first-come sides leave a tag over
  a ring, a tag, a panel or the edge, up to four tags share the room: every choice of sides, a tag above or below also flush
  with its ring's left or right edge, is weighed and the least covering wins. Phones keep #630's first-come placement as it
  was, which is why the phone pictures are unchanged.

Checks:
- `tour.test.ts` 2.18: the rounding case (red: 'left', then green) and the 1280 sharing case (red: Part 3 over the sessions
  list, then green).
- The browser journey `--verify-immersive` now checks the claim and parallel steps' tags at 1920, 1440 and 1280 as well as
  390 and 320: every tag inside the screen and clear of the other tags, the other rings, the card and the panels (red at
  1920 on main: Part 2 over the cart's ring). Its pictures are in `journey/`.

Residue (parked on the arc): at 1280×800, reached from the claim step, the parallel step's camera leaves Browsing and the
cart on the sessions list's top edge, so their island names sit under the list. That is the camera's framing, not the tags',
and moving it would move the phone view too.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 120 pictures, each one's last copy kept in git history at [`after/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/agents-laptop/after) (35), [`before/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/agents-laptop/before) (35), [`journey/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/agents-laptop/journey) (50).
Removed from `main` on 2026-10-23, its arc closed (the owner's answer to question_fd8ff8dfaf88): [1440-claim-to-parallel.webm](https://github.com/storytree-ai/storytree/blob/8e81c65e1fcbbad88f4753e814f2fe64cd32c8d2/packages/website/evidence/agents-laptop/1440-claim-to-parallel.webm). Each link is its last copy, kept in git history.
