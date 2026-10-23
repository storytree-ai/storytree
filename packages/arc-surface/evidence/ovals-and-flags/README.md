# Increments are flat ovals, and a claim plants the globe's flag on its oval — ADR-1003

The actual desktop renderer, captured unedited with headless Chromium 148 over an isolated Postgres
and an explicit fixture, in the dark and the light theme. Nothing in the owner's library or running
app is opened or changed. Run after `apps/desktop/build.mjs`:
`node --import tsx packages/arc-surface/evidence/ovals-and-flags/capture.mjs [--retake]`.

- Lanes at true size: [dark](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags/lanes-dark.png), [light](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags/lanes-light.png)
- The same, 4× close-up: [dark](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags/lanes-dark-4x.png), [light](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags/lanes-light-4x.png)
- The drawer at true size: [dark](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags/board-dark.png), [light](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags/board-light.png)
- [Measured results](capture.json)

The fixture, top to bottom:

- *Website* — three landed (green), one waiting on the owner (yellow), one unclaimed (grey), one held
  by a live session (its flag flies), one held by a session idle 42 minutes (its flag furled and
  greyed).
- *Docs refresh* — one landed, two unclaimed, no claims: its ovals sit 3 px under its title.

What the capture asserts, in both themes: every increment is a 16 × 8 oval with no dot in it; each
flag's pole stands at its oval's middle, left of centre; each flag's top clears the title row by
about 2 px (measured 2.7); the idle holder's pennant is under 0.6 of the live one's width.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 6 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/ovals-and-flags).
