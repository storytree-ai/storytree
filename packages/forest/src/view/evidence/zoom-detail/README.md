# Every island carries the capability tree's detail, shown by zoom (ADR-1253 D2, contract 3.86)

The real desktop page on storytree's own map (the code-rows snapshot and its survey, 15 islands), nothing selected, taken
by `packages/forest/testing/view/zoom-detail/capture.mjs` at 1440 x 960. Every island is laid out by its links and routed
whether or not it is selected; the eye's zoom alone decides which marks show.

Pictures:

- `far.png`: the eye at the wheel's floor (zoom 0.48 CSS px per ground unit, half the whole map's): islands, names and the
  sea's lanes only.
- `opening-territories.png`: the whole map as it opens (zoom 0.96): every island's territories in their health colours, no
  roads and no capability names.
- `near-the-library.png`: near (zoom 2.8): roads, gates, relief, settlements and capability names on every island, none of
  them selected.

## The thresholds, measured

The eye's zoom on this map: 0.96 at the opening, 0.48 at the wheel's floor (always half the opening), 29 at its ceiling.
The territories show from 0.75 of the zoom that frames the whole map, so every map opens on them and the floor always
reaches far; the near marks from 2 CSS px per ground unit, where a gate (4.2 units) stands about 8 px long. Each level
changes 12% past its threshold either way, so a zoom resting on one does not flicker.

## Frame times

A 120-frame pan, one move asked for each frame. This box draws WebGL in software (SwiftShader, no GPU), so the frame times
here measure the CPU rasterising pixels; the page's own work per frame (the scene drawn, `gl.render`) is 1.6 ms median and
12 ms at the 95th percentile at near, with 335 draw calls.

| View | median | 95th percentile | worst | frames over 50 ms |
| --- | ---: | ---: | ---: | ---: |
| Opening, this branch | 16.7 | 66.7 | 116.6 | 10 |
| Opening, main | 16.7 | 50.1 | 116.6 | 7 |
| Near, this branch (every island's detail) | 16.7 | 99.9 | 100 | 23 |
| Near, main (The library selected, its detail alone) | 16.7 | 50 | 66.6 | 2 |
| Every island's roads and relief forced on at the whole map's zoom | 16.7 | 83.2 | 83.4 | 11 |

Two measured fixes went in before these numbers: capability names show only near (mounted at the territories level on
every island, 91 names, they doubled the opening's median frame to 33 ms, the page laying them out each frame), and each
island's built marks no longer recompute their matrices every frame (the scene's matrix walk was 3 to 4 times main's).

## On load

Every island's roads were routed 7.0 s after the map was ready, a few islands at a time in the territory worker. The page ran
about 65 tasks over 50 ms meanwhile (the longest 503, 448 and 440 ms; main's longest 507, 426, 244 and 214 ms with 8 over
50 ms): each island's land and road marks are built on the page as its roads arrive, one island per task.
