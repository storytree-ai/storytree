# Sessions list: bars and totals line up, names fit

Increment `increment_8935a131987d` (arc `arc_895e232031b0`), contract area: forest capability 7; ADR-0737.

`check.tsx` renders the real `SessionsList` with `src/view/styles.css` in headless Chromium, rows with different
labels and badges (short, two 40-character names, "+1 · needs you", "needs you"), at 1440px and 420px, and asserts
every row's bar starts at the same x, every total ends at the same x, and a 40-character name shows whole at the
default width.

- Red (`6a1ad93`, storytree-ai/storytree#184): at 1440px the bars started at 335 / 335 / 508 / 393; at 420px at
  196 / 196 / 278 / 250.
- Green (#184): the list has a fixed width (`min(470px, 100% - 32px)`) and the label takes the free space uncapped,
  so the bar and total sit flush right on every row: 358 at 1440px, 326 at 420px (`edges.json`, `rows-*.png`).
- ADR-0737 follow-up: the "off plan · N files" badge and its evidence panel are gone. The label column at the default
  width is about 290px; two wide ordinary 40-character names fit unclipped at both widths, which is where the claim
  reason limit (agent link contract 5.16, `CLAIM_REASON_LIMIT = 40`) comes from. A row with badges still ellipsises
  a longer, older name as a last resort.

The bar is still an empty slot; filling it is `increment_ce9f45c6cce8`.
