# Neighbour rings on the globe

Forest contract 3.27. Selecting a story rings each neighbour island in its relation's lane colour: **#0d8fb0** for a
story it builds on ("up"), **#6a5fee** for a story that builds on it ("down", also used when both hold). A ring starts
wide (5) and faint (opacity 0.45 x 0.9) and settles over 0.72 s to width 1.5, opacity 0.9. The selected island keeps its
yellow ring (width 2).

These are untouched 1440 x 960 captures of the planet-pathways seed (copied as [seed.json](seed.json)), real desktop page,
dark theme, device scale 1, headless Chromium with software GL. The selected story is "The agent link": one story it
builds on (the library) and three that build on it (the app, the arc surface, the command line). The seed has no story
on both sides of the selected one, so the "both reads violet" rule is covered by the product tests, not these pictures.

| Picture | Shows |
| --- | --- |
| [selected.png](selected.png) | Settled, 1.6 s after the click: three violet rings and one teal ring on the neighbours, yellow ring on the agent link. |
| [pulse.png](pulse.png) | About 0.1 s after the click: the same rings still wide and faint (best effort; the capture retries up to eight times and keeps the first whose rings were still settling after the picture). |
| [deselected.png](deselected.png) | After a click on open sea: no ring of any colour. |

[measurements.json](measurements.json) lists every ring mesh (name, relation, colour, opacity, inner and outer radius,
width, render order, depth flags) when unselected, settled and deselected, the pulse readings before and after its
screenshot, and a `summary`. The capture asserts that the ringed stories and relations equal the selected story's
cross-story neighbours computed from the seed, that the selected story has no neighbour ring, each ring sits on its own
plate in its relation's colour at opacity 0.9 and width 1.5, there is one yellow ring, and none remain after deselect.

## Reproduce

[build.mjs](build.mjs) bundles the actual desktop renderer; its only source additions expose R3F state and the page's
rotation setter for observation. [capture.mjs](capture.mjs) replaces Electron's read bridge with the committed seed.
Bundles stay in ignored `dist/`. From the repository root:

```sh
node packages/forest/src/view/evidence/neighbour-rings/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/src/view/evidence/neighbour-rings/capture.mjs --retake
```

The capture is a heavy run: like the other captures it does not take the lock itself (an evidence folder may not import
another story's package), so run it under the machine's heavy-run lock from outside. Windows has no `flock`; a one-line
wrapper that calls `acquireHeavyLock` from `packages/dev-loop/src/heavy-lock.mjs` and then spawns the command above does
the same. Without `--retake` the output goes to a scratch folder. `PLANET_PLAYWRIGHT` and `PLANET_CHROMIUM` override
the Playwright and Chromium paths.
