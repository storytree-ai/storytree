# Storytree's globe fits a laptop (contract 2.23, increment_6da857f8ab07)

At 1440×900 and 1280×800 storytree's own globe, framed at the resting 1.1, ran past the screen's right edge, under the compass
and into the bottom bar's band: in the arrival it sits right of the words, so the names round its east rim hung off the screen,
"The command line" at its north ran under the compass and "The world" at its south sat in the tour bar; in free play the names
below the sessions list (Keys, Process ledger) stood in free play's line by the waitlist button. The phone counterpart is
contract 2.22 (`../own-globe-phone/`).

## What changed

- **Framing.** On a laptop storytree's globe is framed smaller: 1.4 in the arrival (pain, grow, value, fixes; `ownLaptop` in
  `src/tour-copy.ts`), 1.25 in the everything step and 1.25 in free play on storytree (`freePlayFraming` in
  `src/tour-camera.ts`). Phones and the shop are unchanged. The smaller arrival globe also stops crossing the dated note at the top.

## Check

`pnpm --filter @storytree/website build && node packages/website/evidence/capture.mjs own-globe-laptop/after --verify-own-globe`
now plays 2.22's journey at 1440×900 and 1280×800 too, and on a laptop also counts a name inside the band from the bottom bar's
top (or the waitlist button's, whichever is higher) to the screen's foot. It writes both contracts' verdicts to
`own-globe-observations.json` for `pnpm record:acceptance`.

- `before/`: main at the branch's base with the extended check. 2.23 red: 13 names (once per view and width) in the value and
  fixes steps and free play, at both widths (`own-globe-failed-*` is the first failing moment of each view). 2.22 passed.
- `after/`: this branch. Both pass, three runs in a row. The phones' pictures are left to `../own-globe-phone/`.

| View | Before | After |
|---|---|---|
| Value, 1440 | `before/own-globe-failed-value-1440.png`: The world in the tour bar | `after/own-globe-value-1440.png` |
| Fixes, 1280 | `before/own-globe-failed-fixes-1280.png`: The app setup, CI health, The dev loop off the right edge; The command line under the compass; The world in the bar | `after/own-globe-fixes-1280.png` |
| Free play, 1440 / 1280 | `before/own-globe-failed-freeplay-*.png`: Keys and Process ledger in free play's line | `after/own-globe-freeplay-*.png` |
| Everything, 1440 / 1280 | `before/own-globe-everything-*.png` | `after/own-globe-everything-*.png` |
