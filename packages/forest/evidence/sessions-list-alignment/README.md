# Sessions list: bars and totals line up

Increment `increment_8935a131987d` (arc `arc_895e232031b0`), contract area: forest capability 7.

`check.tsx` renders the real `SessionsList` with `src/view/styles.css` in headless Chromium, four rows with
different labels and badges (short, long, "+1 · needs you · off plan", "needs you"), at 1440px and 420px, and
asserts every row's bar starts at the same x and every total ends at the same x.

- Red (`6a1ad93`): at 1440px the bars started at 335 / 335 / 508 / 393; at 420px at 196 / 196 / 278 / 250.
- Green: the list has a fixed width (`min(470px, 100% - 32px)`) and the label takes the free space uncapped, so the
  bar and total sit flush right on every row: 358 at 1440px, 326 at 420px (`edges.json`, `rows-*.png`).

The bar is still an empty slot; filling it is `increment_ce9f45c6cce8`.
