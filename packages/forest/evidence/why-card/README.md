# The drill-down card says why a capability is not green, and who moves it (forest 4.12, ADR-0825 D1/D2)

Seeded, repeatable captures: `node packages/forest/evidence/why-card/capture.mjs` bundles the fixed
tree in `entry.ts` (no randomness, no clock) through the real `drillDown` view model and the real
`renderStoryPanel`, with the desktop page's real `styles.css`, in headless Chromium at fixed
viewports (1280 x 800 desktop, 390 x 844 narrow). Measured values are in `measurements.json`.

Pictures (dark unless named):

- `needs-you.png`, `needs-you-light.png`: "Why not green: 8.1 needs something only you can give, since 27 Sep. You move this one."
- `agent-no-test.png`: "Why not green: no test names 1.2 and 1.3. The agent moves this one."
- `not-re-run.png`: "Why not green: 9.1 was not re-run. The agent moves this one.", contracts unfolded; 9.1's row says "last seen failing 27 Sep, not re-run since".
- `healthy.png`: a healthy capability, with nothing added (0 `.panel-why` lines).
- `needs-you-narrow.png`, `not-re-run-narrow.png`: the same at 390 px wide.

Measures, quoted before judging: each not-green shot has exactly 1 why line and each healthy shot 0;
the panel's scrollWidth equals its clientWidth in every shot (nothing overflows sideways, 478 px
desktop, 364 px narrow); the why line is 14.4 px text against the 16 px body.

Principles designed against:

- Meaning outranks appearance: the reason, who moves it and the contracts are words in the sentence;
  no colour carries them (ADR-0082: "needs owner" is carried by the witness, not a colour). The
  owner's case differs by "You move this one." in bold, not by a tint.
- Legible at the resting view: the line sits directly under the capability's word, above its
  description and contracts, so it is read without unfolding anything; at 390 px it wraps to three
  lines and stays whole.
- Words for the owner are plain: "needs something only you can give", "last seen failing 27 Sep, not
  re-run since", contracts named by the number their title starts with (else the title).
- One element per signal: one line per capability, one note per not-re-run contract; a healthy card
  says nothing more.

Not in these pictures: the tree's cards themselves are unchanged (the fixture's tree is wider than the
panel's frame, so it opens cropped here; the app fits it on open, ADR-0744).
