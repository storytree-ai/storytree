# The decision card with More open shows Next and End tour without scrolling (increment_5f1681367e8c)

The real desktop page on the eight-story forest snapshot at 1440 x 960, the tour taken and Next pressed until the decision's
card shows, then More (contract 3.1). `node --import tsx packages/teaching-cards/testing/decision-card/capture.mjs before|after`
(append `--retake` to write here). Each view measures the card and its two buttons, and whether each button is what is drawn
at its own centre.

- `decision-card-more-open-before.png`: main with the gold-dot drawing (increment_20c0a7c00740): the card fills the window's
  height and scrolls as one, so Next and End tour sit at 977 to 998 px, below the window, reached only by scrolling inside it.
- `decision-card-more-open-after.png`: only the card's text scrolls; Next and End tour stay at its foot, at 915 to 936 px,
  on show.
- `decision-card-scrolled-to-its-end-after.png`: its text scrolled to its end, the drawing whole above the decisions list.
  A card with More open is at most 24rem tall since increment_d0639d5f51b3 (contract 3.5), except one that draws, as this
  one does, so the drawing is never cut: its text's foot fades while more of it lies below.

In the evidence bucket for #755, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `755/decision-card/decision-card-more-open-after.png`, `755/decision-card/decision-card-scrolled-to-its-end-after.png`.
