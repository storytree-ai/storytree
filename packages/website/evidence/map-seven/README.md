# The map chapter in seven steps (ADR-0891, amended 2026-10-06; contract 2.16; increment_21eac7f4817c)

`before/` is `main` at 224b861b (eight steps); `after/` is this branch (seven). Each picture is its step as it settles, played in
order at 1920, 1440, 1280, 390 and 320, on SwiftShader. `after/1440-steps-1-to-3.webm` is steps 1 to 3 playing at the tour's 0.75×
(`before/` has the same span). `framing.json` says, for each step and width, whether the islands the step frames stand in view and
clear of the header band, the card and the bar (an island is taken to reach three name-heights above its name).
Made with `node packages/website/evidence/arrival/capture.mjs --only mapSteps [--to <folder>] [--dist <main's dist> --before]`.

| # | Step | The globe shows | Framed |
|---|---|---|---|
| 1 | Your project, shown as a collection of stories. ★ | The shop's empty globe swelling from a point | — |
| 2 | Let's build a shopping site. ★ ✎ ★ | The four planned stories rise; signing in lit and built (and browsing's products list, which came in the same landing, faint); the other three stay faint | Laptop: all four. Phone: signing in |
| 3 | Stories are like the organs of your app ✎ | Browsing, the cart and checkout grow at once; the pathways come on as the second line is said. How: where the organs analogy breaks (pathways run one way) | Laptop: all four. Phone: the cart, with checkout and browsing |
| 4 | Look inside a story and you'll find its parts | The cart, closer in, its cart page tagged | The cart |
| 5 | Your code is shown as dots in the parts. ★ | The cart's file dots | The cart |
| 6 | Parts have colours. ★ | The shop at the end of its build (04:21), when its CI had passed all 34 parts: the four teaching stories lit, all green | Laptop: all four. Phone: the cart, with checkout and browsing |
| 7 | As your project grows, more stories are added. ★ | Orders rises with its pathways to browsing and the cart, and from checkout; the comparison is in its depth | Orders, with browsing, the cart and checkout |

★ the owner's words, ✎ his words lightly edited; the rest is DRAFT, marked in `src/tour-copy.ts`.

**Framing.** Before: Checkout's island ran under the header on the planned and together steps at every width (10 misses; its file also lists the clip's run).
After: 1 miss, at 320 only, step 3: the card's three lines are tall there, and Checkout's island sits just under the wrapped header
note. 1440, 1280 and 390 are clear on every step.

**Choices made here.**
- The four teaching stories run from checkout at the top of the globe to signing in at its foot, so a laptop shows them together at
  a wider framing (1.15), and a phone, with no room to show all four at a size that reads, frames the story the step names and its
  neighbours.
- Step 6 stands at the end of the shop's build, not after its first round as before: in the first round browsing's later parts
  were not yet checked, so the step would not show all parts green. The cost: the shop's other four stories are on the globe,
  dimmed, at step 6, and step 7 replays from before they rose, so they vanish and rise again.
- Step 3's pathways switch on as its second line is said; they do not draw along their length (that motion is the drawing
  engine's, in `packages/forest-world`).
- The narration lighting each planned story as it is named (the old step 2) is retired with that step.
