# Names stay inside the screen on the glass sheet (increment_b1db42e3cae2)

Contracts 2.22 (phones) and 2.23 (laptops), checked in the browser on the glass sheet:

`pnpm --filter @storytree/website build && node --import tsx packages/website/evidence/capture.mjs sheet-names --verify-own-sheet --retake`

To judge one framing guess in seconds rather than minutes, name one width and one view, for example
`--verify-own-sheet --width=390 --view=everything` (widths 390, 320, 1440, 1280; views grow, value, fixes, harness, everything,
freeplay, shop). A run narrowed so judges no contract and writes no `own-sheet-observations.json`.

Both PASS at 1440×900, 1280×800, 390×844 and 320×844 (`own-sheet-observations.json`): every island name storytree's sheet
shows stays inside the screen and clear of the compass (and on a laptop the bottom bar) in the arrival, the value, fixes and
harness steps, the everything step and free play on storytree; on a phone the shop's sheet in free play too. Each
`own-sheet-<view>-<width>.png` is that view as last sampled.

The rule: a sheet wider than the screen is framed from its west edge (forest 3.66), so the tour frames storytree's sheet
whole, its edge names included, beside its words on a laptop; and its whole-map steps no longer drift, since a sheet has no
far side and a drift panned its names off the screen. The shop's phone free play is framed a little wider for the same
reason. The run before this change failed 2.22 at every phone view and 2.23 at every arrival and everything view (names off
the right edge, as in `../sheet-tour/sheet/1440-grow.png` and `320-freeplay.png`).

The saved stills in `public/` (`forest-*.png`, `shop-*.png`, shown when WebGL cannot draw) are retaken from the sheet by
`shop-stills.mjs`, now cut to the sheet's band instead of a square. (Since 2026-10-20 storytree's are retaken from the framed
map by [`../forest/forest-stills.mjs`](../forest/forest-stills.mjs), and the shop's have left the page.)

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 26 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/sheet-names).
