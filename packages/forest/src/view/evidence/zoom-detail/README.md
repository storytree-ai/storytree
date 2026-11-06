# Every island carries the capability tree's detail, shown by zoom (ADR-1253 D2 as narrowed by ADR-1272 D1, contract 3.86)

The real desktop page on storytree's own map (the code-rows snapshot and its survey, 15 islands), nothing selected, taken
by `packages/forest/testing/view/zoom-detail/capture.mjs` at 1440 x 960. Every island is laid out by its links and routed
whether or not it is selected; the eye's zoom alone decides which marks show.

Pictures:

- `floor.png`: the eye at the wheel's floor (zoom 0.48 CSS px per ground unit, half the whole map's): every island's
  territories still in their health colours, no roads and no capability names (ADR-1272 D1; until then this was `far.png`,
  the bare grey ground with names, lanes and flags only).
- `opening-territories.png`: the whole map as it opens (zoom 0.96): every island's territories in their health colours, no
  roads and no capability names.
- `near-the-library.png`: near (zoom 2.8): roads, gates, relief, settlements and capability names on every island, none of
  them selected.

## The thresholds, measured

The eye's zoom on this map: 0.96 at the opening, 0.48 at the wheel's floor (always half the opening), 29 at its ceiling.
The territories show at every zoom (ADR-1272 D1: Mick, 2026-11-05, "i see no value in turning the islands grey on the
farthest zoom. just means you cant see health and only the flags"; the far level below 0.75 of the whole map's zoom is
gone); the near marks show from 2 CSS px per ground unit, where a gate (4.2 units) stands about 8 px long. The level
changes 12% past it either way, so a zoom resting on it does not flicker.

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

### The biggest island's land in steps (3.87, increment_ac6b6706ee92 step 2)

An island's land with its relief and roads is now built in four turns: the relief, the territories' meshes, the relief's
marks, then the roads' (`useBuiltInSteps`); each next step waits ahead of later builds, and a land overtaken between steps
lets go of its meshes. Timed round each turn in the page (`performance.measure`, taken out again), main and this branch
alternated on this box (load average about 20 from other lanes):

| Build | builds | over 50 ms | longest (ms) | page tasks over 50 ms after ready |
| --- | ---: | ---: | --- | ---: |
| main | 74, 75 | 4, 8 | 193, 152, 90 / 189, 110, 106 | 89, 93 |
| This branch | 120, 120 | 2, 2 | 86, 51 / 73, 63 | 83, 83 |

The land no longer makes the long builds: a third, labelled run found the builds still over 50 ms are islands' layouts
(the link layout settled from kept seeds, one build each, up to 156 ms on the loaded box). Settling that in steps, or off
the page, is the next step. The page's own long tasks barely fall, as before: on this box they are frames and shader
compiles that SwiftShader runs on the CPU.

### An island's layout in steps (3.87, increment_ac6b6706ee92 step 3)

Timed first, bundled as the page gets it (esbuild, run in Node on this box): of an island's layout, the fine cut (about
260 Voronoi cells, then shared out by halving) took 25 to 65 ms, the seeds 1 to 5 ms, the settle 3 to 26 ms over its tries,
and drawing it back 1 to 3 ms. So the cut, not the settle, made the long layouts. Now the layout is a generator
(`islandLayoutSteps` in `territories/link-layout.ts`, built through `useBuiltInSteps`): the cut yields every 32 cells' outlines
and every 32 cells shared, then the seeds, then each try at growing the territories, each a step. Three round islands, three
runs each (load average about 15 from other lanes):

| Island | whole layout (ms) | steps | longest step (ms) |
| --- | --- | ---: | --- |
| 7 territories, The library's size | 65.9, 43.7, 32.9 | 19 | 11.7, 5.3, 3.7 |
| 12 territories, 1.5 times as wide | 30.3, 33.4, 27.8 | 17 | 4.7, 4.4, 3.9 |
| 20 territories, 2.2 times as wide | 36.6, 36.9, 31.5 | 20 | 12.2, 6.6, 5.0 |

The same layout results, step by step or at once (link-layout.test.ts, 3.87).

### In the page after the layout's steps (3.87, increment_ac6b6706ee92 step 4)

Timed round each turn and each task of the page queue (`performance.measure`, taken out again), with the page's long
animation frames and a CPU profile from the map's ready until every island's roads were routed, four runs on this box
(load average about 1):

| Run | turns | turns over 50 ms | longest turns (ms) | queue tasks | tasks over 50 ms | longest tasks (ms) |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| 1 | 355 | 1 | 63, 41, 26 | 32 | 2 | 69, 63, 50 |
| 2 | 355 | 1 | 58, 31, 26 | 32 | 3 | 64, 60, 56 |
| 3 | 355 | 1 | 56, 33, 27 | 32 | 3 | 61, 60, 52 |
| 4 | 355 | 1 | 67, 36, 31 | 34 | 3 | 74, 62, 53 |

So the islands' builds hold the line: one turn in 355 over 50 ms, and a queue task over it by at most 24 ms, when a turn
runs longer than the ones before it. The page's long animation frames after ready are those tasks plus their frame (51
to 81 ms) and one more, 205 to 213 ms, that is not the forest's: a React render of the knowledge core's notes under the
sheet (`KnowledgeGlobePoints`, 145 to 165 ms of it in `sheetPoints` and its `apart`, packages/knowledge-core), laid out
again when the sheet moves as islands settle. The frames over 200 ms before ready (283 to 509 ms) are the app's first
mount. The left rail drag test 2.46 on CI's macOS runner took 262 s on step 3's pull request (#513), against 107 to 130 s
on #501, #511 and #512, 226 s on #495 and 58 s on #493 before the queue: the layout's steps did not bring it back, so its
time comes from how many frames the page draws there, not from long builds.

In the evidence bucket for #493, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `493/far.png`, `493/opening-territories.png`, `493/near-the-library.png`.
