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
Routing stays off the page (3.82); moving or spreading that building is parked as increment_ac6b6706ee92 on this arc.

### Each island's build in its own turn (3.87, increment_ac6b6706ee92)

Measured first, per island, in the page (`performance.measure` round each build, the 15-island map): the layout settle
from kept seeds up to 69 ms (539 ms in all), the territories' meshes up to 54 ms (971 ms in all, built about four times an
island), the relief 33 ms, and the relief and road marks up to 114 ms. None dominates; what made the long tasks was that
they ran together: once every island's docks arrived, all 15 islands were laid out and their land built in one 876 ms task,
and the whole scene's shaders were compiled again on every island's roads (645 ms over the load).

Now each island's layout, and its land with its relief and roads, wait their turn in one page queue (`build-turns.ts`), one
build per task at first (a few to a task since, below), and a build overtaken while it waits never runs; each island compiles its own marks' shaders as they are
built. The page's long tasks after the map was ready, until every island's roads were routed, on this box (loaded by other
lanes, so two runs each, back to back):

| Build | tasks over 50 ms | longest (ms) |
| --- | ---: | --- |
| This branch | 121, 110 | 363, 279, 205 / 283, 176, 113 |
| main | 75, 76 | 701, 360, 330 / 1531, 494, 466 |

The longest tasks fall by half or more, but the count does not: most tasks over 50 ms here are frames, which this box
rasterises in software (SwiftShader), and a spread load draws more of them. Of the 75 builds in one run, 10 still took
over 50 ms, the largest a 208 ms land with its relief and roads on the biggest island; splitting that build further, or
building the meshes off the page, is the next step on increment_ac6b6706ee92.

One build per task cost a frame per build, and on CI's macOS runner, which draws without a graphics card, that kept the
page busy long enough after it was ready to fail the left rail's drag (2.46, twice). With motion reduced (no animation asking
for frames), the left rail test's page drew 46 frames before it fell idle on this branch against main's 16. So a task now
runs builds while the next is likely to fit 50 ms (its builds so far, plus the longest of them again): 29 and 33 frames.

In the evidence bucket for #493, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `493/far.png`, `493/opening-territories.png`, `493/near-the-library.png`.
