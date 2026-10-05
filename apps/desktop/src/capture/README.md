# Desktop capture kit

A new look supplies a seed and views to `runCapture`; the runner owns the static
server, workspace Playwright/Chromium launch, typed stand-in bridge, ready wait,
frame settling, pictures, measurements and cleanup. See the working
[rows capture](../../../../packages/forest/src/view/evidence/rows/capture.mjs).

```js
await buildCapture({ dist });
await runCapture({
  folder, dist, seed, survey,
  prepare: async ({ page }) => {
    // Wait for this look's scene or dismiss its guide through normal controls.
  },
  views: [
    { name: 'opening' },
    {
      name: 'detail',
      prepare: async ({ page }) => { /* select the view */ },
      measure: async ({ page }) => page.evaluate(() => document.body.dataset.state),
      expect: state => assert.equal(state, 'ready'),
    },
  ],
});
```

Run scripts with `node --import tsx`. The seed holds `projects`, `tree`, `changes`,
`lines` and `covers`; `survey` is optional. A typed `answers` object can override
bridge reads. Unseeded known reads receive the bridge's quiet defaults; an unknown
method fails with its name. A view writes `<name>.png` and, when measured,
`<name>.json`; `picture: false` omits the picture and `measurement` changes the JSON
filename. The return value is the array of measured values.

Globe captures built with `buildCapture` can call `visibleGlobeTargets(page)` once
the globe is ready. It returns the camera's `zoom` and sorted `dots` and `islands`,
each with an `id` and page coordinates `x`, `y`. It conservatively chooses centres
nearer the eye than the globe's centre, excluding hidden objects and centres
outside the canvas. Pass `{ x: 0.5, y: 0.6 }` to choose
only the middle half-width and 60% half-height. This is a scene observation, so an
HTML panel may still cover a target; dismiss panels before using its coordinates.

`await zoomGlobe(page, opening.zoom * 1.5)` sends real wheel events over the canvas
until the orthographic zoom is within 3% of the target (the wheel moves in notches),
and returns the attained zoom. Pass a target's coordinates as a third argument to
place the pointer there. `zoomGlobe(page, opening.zoom)` returns to the opening
scale. It refuses targets outside the controls' range and fails if the wheel does
not change the camera. See the [reach-sized dots capture](../../../../packages/knowledge-core/evidence/reach-sized-dots/capture.mjs)
for choosing visible notes, seeding their reads, then framing both full and close
views in one invocation.

Existing interaction journeys and performance probes use `withCapture` with a
callback receiving `{ browser, origin, out, settle }`. They keep their local
expectations while sharing server/browser lifetime; this form does not create a
page or settle automatically during a timed measurement. Omit `dist` for
`setContent` previews, and use `softwareGL: false` for pure HTML/SVG: ANGLE flags
can prevent those previews from taking screenshots. Forest captures use software
GL by default. Electron captures use `loadPlaywright` for their existing CDP flow.

Outputs go through `captureOutput`: scratch by default, the evidence folder only
with `--retake`. `CAPTURE_PLAYWRIGHT` and `CAPTURE_CHROMIUM` override the workspace
module and installed browser; older `PLANET_*` and `STORYTREE_PLAYWRIGHT` names are
retained. No script needs a home-directory path or another server/launcher copy.
