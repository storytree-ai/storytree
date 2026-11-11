# The decision card with More open shows Next and End tour without scrolling (increment_5f1681367e8c)

The real desktop page on the eight-story forest snapshot at 1440 x 960, the tour taken and Next pressed until the decision's
card shows, then More (contract 3.1). `node --import tsx packages/teaching-cards/testing/decision-card/capture.mjs before|after`
(append `--retake` to write here). Each view measures the card and its two buttons, and whether each button is what is drawn
at its own centre.

- `decision-card-more-open-before.png`: main with the gold-dot drawing (increment_20c0a7c00740): the card fills the window's
  height and scrolls as one, so Next and End tour sit at 977 to 998 px, below the window, reached only by scrolling inside it.
- `decision-card-more-open-after.png`: only the card's text scrolls; Next and End tour stay at its foot, at 915 to 936 px,
  on show.
