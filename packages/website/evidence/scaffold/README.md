# Website scaffold

This is the first increment's static shell. The home-page content and the saved
forest scene follow in separate increments; no live preview is claimed here.

Reproduce from the repository root:

```sh
pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs scaffold
```

The capture uses headless Chromium, a static server, reduced motion, and fixed
1440 × 1000 and 390 × 844 viewports. The server and browser close when it finishes.

- **Legible at the resting view** (`principle_1e3418812c33`): the headline and
  repository link are visible on arrival at both sizes. The supporting text is
  20 px on desktop and 17 px on the phone. Neither page scrolls horizontally.
- **The resting view is designed, not fitted** (`principle_43ea5d4f68c4`): desktop
  content occupies 1180 of 1440 horizontal pixels; phone content occupies 350 of
  390. The forest slot has a deliberate 240 px minimum height in this shell.
  The forest increment supplies its own camera and framing.

These are evidence of the built composition, not an acceptance of its appearance.

[Desktop](1440.png) · [Phone](390.png) · [Measurements](measurements.json)
