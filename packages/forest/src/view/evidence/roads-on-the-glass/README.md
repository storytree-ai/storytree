# Roads stay on the glass, and the islands drop away sooner

The owner, 2026-10-05, in the app after #652: "desktop app looks like its a little buggy i can see a stray pathway. also
the zoom past the islands doesnt seem to work." Both reproduced on storytree's own plan (the `../code-rows` seed, 15
stories with their code) in the actual desktop page at 1440 × 960, before (merged #652) and after this landing.

**The stray pathway.** One of 27 roads, The librarian to The world, came 5.75 units inside the glass: its routed path
stopped near The librarian, and its last point, The world's dock, was 205 units away, joined by one straight chord.
Roads are routed on an azimuthal chart about the globe's +z; The world sits 122° from it and Keys 135°, where the chart
stretches land up to 3.3 times sideways, so the router's disc for the island ends far from its real coast. Before
ADR-0919 the chord was lost among the far side's land showing through the glass; behind the one-way glass it stood
alone. Now any gap between a road's points is filled along the globe's surface (`alongTheGlobe` in `pathways.ts`, the
world's 6.12): no road comes inside the glass, and no two points of any road are more than 1.12 units apart.
[stray-roads-before-after.png](stray-roads-before-after.png) shows four turns where it showed;
[front-before-after.png](front-before-after.png) shows the front unchanged, The world's long run lying on the far side.

**The zoom.** The wheel did take the eye past the islands, but only after about 45 notches from the opening view
(framing 0.12); now they drop away at framing 0.30, about 27 notches and four times the opening zoom, past capability
names (about twice) and file circles (about 2.6 times). See `wheel` in [measurements.json](measurements.json): 15
island grounds shown up to 25 notches, none from 30.

Not done here: a far island's road still runs the unrouted stretch along the surface from where routing stopped.
Centring the chart on the islands (the best pole leaves the farthest island at 98°, not 135°) would shorten those
stretches, but moves every route.
