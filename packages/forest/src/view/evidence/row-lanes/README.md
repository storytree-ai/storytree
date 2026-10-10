# Row lanes: selecting a story lights every dependency its row comes from

Forest 3.26 and world 6.8, on storytree's own globe (the seed and code survey in `../rows-on-screen`, 21 stories,
2026-10-10). The real desktop page at 1440 x 960 in headless Chromium with SwiftShader, through the shared capture kit.

An island's row is ranked by the code's package dependencies where its story is surveyed (ADR-0840 D2), but a
selection lit only the plan's capability links. The website sits in row 7 because of five code dependencies and has
no capability link to another story, so selecting it lit nothing.

| | |
| --- | --- |
| [before-website-selected.png](before-website-selected.png) | main: The website selected, no lane lit |
| [after-website-selected.png](after-website-selected.png) | this branch: five blue "builds on" lanes, one to each of The arc surface, CI health, The forest, The knowledge core and The world |
| [after-website-turned.png](after-website-turned.png) | the same selection spun 75° about the poles: the lane to The forest runs over the horizon (98% of it behind the globe) and CI health's 66% |

The measurements are `before-website-*.json` and `after-website-*.json`.

**Route.** A row dependency no capability link joins has no road, so it gets a plain lane: from the coast point of the
island built on nearest the other island, along the globe at a road's lift, to the nearest coast point of the island
building on it, one road wide. It is computed with the pathways but kept out of their roads and segments, so nothing
draws it until a story at either end is selected. Like a road, a lane whose other end is behind the globe runs over
the horizon and the globe hides the rest: the pulse ring on the far island shows when its front arrives.

The small example (a new project with no code survey) ranks rows by its capability links, so every row dependency
already has a road there and nothing changes; no picture of it is needed.

```
node --import tsx build.mjs <main checkout> before
node --import tsx build.mjs <this checkout> after
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before --retake
node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs after --retake
```
