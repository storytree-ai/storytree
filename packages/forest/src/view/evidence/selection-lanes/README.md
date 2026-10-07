# Selection lanes on the globe

Forest contract 3.26 (which links light), world contracts 6.8 / 6.9 (routes and draw-on timing). Selecting a story
lights every capability link between it and another story as a lane over its road: **#0d8fb0** for what the story
builds on (upstream), **#6a5fee** for what builds on it (downstream). Each lane draws on from the dependency end at
constant speed over 0.28 to 1.2 s (ease-out cubic). Forest mode only.

These are untouched 1440 x 960 captures of the planet-pathways seed (copied as [seed.json](seed.json): eight stories,
58 capabilities, 28 cross-story links), real desktop page, dark theme, device scale 1. The selected story is the
seed's "The agent link", the one with both directions: 1 upstream link (to the library) and 11 downstream links
(from the command line, the arc surface, the app and the knowledge core). The globe is turned, by the page's own
rotation setter, so the story and its neighbours face the viewer, a little left of the middle to clear the story panel.

| Picture | Shows |
| --- | --- |
| [unselected.png](unselected.png) | Nothing selected: roads only, no lane mesh. |
| [selected.png](selected.png) | After a click on the story's island and 1.6 s: 12 lanes fully drawn over their roads. |
| [mid-draw.png](mid-draw.png) | The same click, captured while drawing (a software-GL frame is slow, so the capture retries up to eight times and keeps the first one whose lanes were still partial after the picture; [measurements.json](measurements.json) `midDraw` gives the draw fractions before and after it). |
| [deselected.png](deselected.png) | After a click on open sea: no lane mesh again. |

[measurements.json](measurements.json) holds, per lane at the final frame, its name, direction, colour, vertex count,
draw range against full index count (all full), length and draw seconds, and whether its first vertices sit at the
dependency end; plus zero lane meshes unselected, deselected and in Library mode (selecting there is closed by the
mode switch). The `summary` block is asserted by the capture.

## Reproduce

[build.mjs](build.mjs) bundles the actual desktop renderer; its only source additions expose R3F state and the page's
rotation setter for observation (the same hooks as the planet-pathways instrument, with the current `invalidate`
destructuring). [capture.mjs](capture.mjs) replaces Electron's read bridge with the committed seed. Bundles stay in
ignored `dist/`. From the repository root:

```sh
node packages/forest/src/view/evidence/selection-lanes/build.mjs
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/selection-lanes/capture.mjs --retake
```

The command wrapper takes the same heavy-run lock as gate/test on Linux, macOS and Windows.
The evidence script does not import another story's package. Without `--retake` the output
goes to a scratch folder. `PLANET_PLAYWRIGHT` and
`PLANET_CHROMIUM` can override the Playwright and Chromium paths.
