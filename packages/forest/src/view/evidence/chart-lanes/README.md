# Shipping lanes as chart dots at rest, a selected story's share filled (ADR-1278 D1, D2)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), first at rest, then with The
library's island clicked, its lanes drawn on and settled, beside the mocks page Mick picked C2 from (attached to
ADR-1278: `storytree media list decision_cf51a88ad845`). The story panel and the left rail are hidden for the picture.

What this step draws (contracts 4.44, 4.8, 4.9, 4.33, 4.39): at rest every lane is a line of round dots in the lane blue
down its merged route, each stretch's dots half its lane width and about twice their size apart, so a trunk carrying more
links reads as bigger dots (the capture counts 29 stretches, 6159 dots at their finest, no lane lit). Selecting a story
fills its share of each stretch it crosses in pale blue, as wide as its own lit lanes there by the same curve, never
wider than the stretch, drawn on from the island built on at one pace; the other dots dim (opacity 0.75 to 0.525). As in
the mock, a lane is never drawn under about 4.5 px for one lane: zoomed out past that, every lane size (dots and fills)
scales up together by a power of two, keeping every second dot at each step so the dots do not crawl while zooming.

Pictures, 1440 x 960 (the mock page full height):

- `at-rest.png`: storytree's own map at rest, every lane dotted.
- `the-library-selected.png`: The library selected (16 lanes lit), its share filled over the dimmed dots.
- `mock-c2.png`: the mocks page with C2 (chart dots, share fill) chosen, for comparison.

Taken with `node --import tsx packages/forest/testing/view/chart-lanes/capture.mjs` (append `--retake` to write here);
the mock page by opening the attached `lane-looks-mocks.html` with C and 2 picked.
