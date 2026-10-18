# Chapter 2's tour on the glass sheet (increment_3019689c8c3f)

Every tour step and free play at 1440×900, 1280×800, 390×844 and 320×844, on the globe it replaces (`globe/`, built from
`2c7fcae2`, main before this change) and on the glass sheet (`sheet/`, this branch). Same file names in both folders, so
`globe/1440-map-stories.png` sits beside `sheet/1440-map-stories.png`.

The "Read more" depth panels it also takes were left out: they cover the map. Taken with `node --import tsx packages/website/evidence/capture.mjs sheet-tour/<folder> --review-chapters` against each build
(`WEBSITE_DIST`). Both runs had no console errors, and `chapter-review.json` finds no caption overflow, sideways scroll or
panel over the caption at any width.

What changed: the map and the inset are drawn on the sheet; the camera pans and zooms it where it turned the globe, a
project's whole view is the sheet's opening at the step's framing (forest 3.66), and between the two projects it still
pulls back and swaps maps. Framings are the short half-side of the view in the sheet's ground units (`tour-copy.ts`).

Known, and parked as increment_b1db42e3cae2: where storytree's sheet (or the shop's on a phone) is wider than the window it
is framed from its west edge, so the easternmost names run off the right edge (for example `sheet/1440-everything.png`,
`sheet/320-grow.png`, `sheet/320-freeplay.png`); contracts 2.22 and 2.23 are restated for the sheet there, with their
browser check.
