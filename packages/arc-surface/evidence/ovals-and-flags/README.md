# Increments are flat ovals, and a claim plants the globe's flag on its oval — ADR-1003

The actual desktop renderer, captured unedited with headless Chromium 148 over an isolated Postgres
and an explicit fixture, in the dark and the light theme. Nothing in the owner's library or running
app is opened or changed. Run after `apps/desktop/build.mjs`:
`node --import tsx packages/arc-surface/evidence/ovals-and-flags/capture.mjs [--retake]`.

- Lanes at true size: [dark](lanes-dark.png), [light](lanes-light.png)
- The same, 4× close-up: [dark](lanes-dark-4x.png), [light](lanes-light-4x.png)
- The drawer at true size: [dark](board-dark.png), [light](board-light.png)
- [Measured results](capture.json)

The fixture, top to bottom:

- *Website* — three landed (green), one waiting on the owner (yellow), one unclaimed (grey), one held
  by a live session (its flag flies), one held by a session idle 42 minutes (its flag furled and
  greyed).
- *Docs refresh* — one landed, two unclaimed, no claims: its ovals sit 3 px under its title.

What the capture asserts, in both themes: every increment is a 16 × 8 oval with no dot in it; each
flag's pole stands at its oval's middle, left of centre; each flag's top clears the title row by
about 2 px (measured 2.7); the idle holder's pennant is under 0.6 of the live one's width.
