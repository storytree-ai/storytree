# Storytree's globe fits a phone (contract 2.22, increment_b7d9fb526564)

On a 390 or 320 phone storytree's own globe ran under the compass (the mini globe, top right) and past the screen's edges in the
arrival (grow, value, fixes), the everything step and free play on storytree. The shop's globe fits; storytree's, with about
twenty names round its rim, did not.

## What changed

- **Framing.** On a phone storytree's globe is framed smaller in those views: 1.36 radii to the room's half short side at 390px,
  1.55 at 320px (the tour), and 1.5 to 1.7 in free play, whose room is the whole screen (`ownPhone` in `src/tour-copy.ts`,
  `freePlayFraming` in `src/tour-camera.ts`). Laptops and the shop are unchanged.
- **Compass.** While the tour plays on a phone the compass sits at the top of the globe's room, 64px, and the dated note beside
  it stops short of it; free play keeps its place and size.
- **Free play's camera.** It now takes the camera from the tour (a drift left running by the everything step kept turning and
  framing free play's globe), and aims at a globe just swapped in until it is drawn (up to 20 s), so storytree's globe is not
  left at the shop's framing while software WebGL draws it.

## Check

`pnpm --filter @storytree/website build && node packages/website/evidence/capture.mjs own-globe-phone/after --verify-own-globe`
plays the arrival at 1.5×, the everything step and free play on storytree at 390×844 and 320×844 with software WebGL, and
measures every shown name against the screen's edges and the compass every 250 ms (free play once its camera has settled). It
writes `own-globe-observations.json` for `pnpm record:acceptance`.

- `before/`: main at the branch's base. Red: 40 names (counted once per view and width) under the compass or off the screen, in all five views at both widths
  (`own-globe-failed-*` is the first failing moment of each view).
- `after/`: this branch. PASS, three runs in a row.

| View | Before | After |
|---|---|---|
| Value, 390 | `before/own-globe-value-390.png`: The app and The app setup under the compass, The arc surface off the left | `after/own-globe-value-390.png` |
| Fixes, 320 | `before/own-globe-failed-fixes-320.png`: names under the compass and off both edges | `after/own-globe-fixes-320.png` |
| Everything, 320 | `before/own-globe-failed-everything-320.png`: The command line under the compass | `after/own-globe-everything-320.png` |
| Free play, 390 / 320 | `before/own-globe-failed-freeplay-*.png`: names off both edges | `after/own-globe-freeplay-*.png` |
