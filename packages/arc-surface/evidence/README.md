# Arc surface over the forest

The #112 captures below are historical. The shared capture harness now exercises the
[ADR-0660 top drawer](drawer-shape/README.md), including remembered state and the restored forest.
Its current output is written under `drawer-shape/`.

Capability 3 of the arc surface story, 2026-09-27. This captures the actual desktop renderer,
HTML and CSS with the app's `pageReads` backed by a fresh, isolated Postgres. The fixture has one
story and five arcs: waiting on an owner question, claimed work with a landing, a queued release,
a parked arc, and a closed experiment. All fixture data is discarded after the run.

Renderer: headless Chromium 148.0.7778.96, ANGLE / Vulkan SwiftShader (Subzero), dark theme,
1440 × 960 at device scale 1. The images are unedited captures.

- [Board](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/arc-surface.png)
- [Question opened in place](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/arc-briefing.png)
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

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 5 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence) (2), [`closed-range/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/closed-range) (3).
