# Arc surface over the forest

Capability 3 of the arc surface story, 2026-09-27. This captures the actual desktop renderer,
HTML and CSS with the app's `pageReads` backed by a fresh, isolated Postgres. The fixture has one
story and five arcs: waiting on an owner question, claimed work with a landing, a queued release,
a parked arc, and a closed experiment. All fixture data is discarded after the run.

Renderer: headless Chromium 148.0.7778.96, ANGLE / Vulkan SwiftShader (Subzero), dark theme,
1440 × 960 at device scale 1. The images are unedited captures.

- [Board](arc-surface.png)
- [Question opened in place](arc-briefing.png)
- [Measured results](capture.json)

The acceptance drives a real claim while the overlay is open, checks that it arrives within one
poll, then advances a stand-in clock and sees the holder become idle without a new line. It also
checks a failed read and retry, question-fold and scroll-position persistence, every lifecycle scope through the
package's smoke check, queued-arc selection, live settlement, read-only UI actions, and Close and
Escape returning to the same forest. Browser errors fail the run. Exact timings and the renderer
are in `capture.json`.

To reproduce from the repository root (no desktop login required):

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/arc-surface/evidence/capture.mjs
```

`ARC_PLAYWRIGHT` can name the installed playwright-core module and `ARC_CHROMIUM` the Chromium
executable. The defaults name the Mint box's existing installation. The capture owns and closes
its browser, local HTTP server and temporary database, and never opens the owner's live project.
The automated Postgres proof also runs in `pnpm test` on every supported platform; the headless
capture is the page acceptance for this landing.
