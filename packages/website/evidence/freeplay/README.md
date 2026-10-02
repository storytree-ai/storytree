# Free play and its waitlist exit

Source: `adb06a9152ca1e4a60c060d66844c88fa085ef9f`. Browser observations name that
build in `tour-observations.json`. This completes `increment_db81bd2e6a97` on
`arc_f3615c975e9c`, using the app-owned saved-reading surfaces delivered in #543.

The waitlist hatch now stays in the viewport's bottom-right corner while free
play is visible, and says what it opens. Replaying or ending the recording keeps
the selected knowledge note open; Escape dismisses it and returns focus to its
picker. On phones, the arc list and its briefing each retain a scrollable row,
with progress bars wrapping above their counts instead of colliding with them.
The website hosts these changes without changing any app package, saved records,
allocation metadata, waitlist promise or storage behavior.

## Pictures

- [Desktop exit while browsing](1440-exit.png)
- [Phone exit and readable arc choices](390-exit.png)
- [Desktop free-play surfaces](1440-freeplay.png)
- [Phone free-play surfaces](390-freeplay.png)
- [Phone without WebGL](390-no-webgl.png)

The exit pictures are viewport captures. The other pictures capture the full
chapter, so a fixed exit appears at the position of the viewport during capture.

## Behavior proof

The existing browser journey protects contract 2.6. It first failed when the
exit was below the viewport (`24f47242`), then when replay lost the selected note
(`8190bdd0`), when phone arc choices collapsed (`f230e44d`), and when two arcs'
progress bars collided with their counts (`2a04ecfc`). The source
above passes those checks and the existing tour checks, including completion and
skip, freely turning the app globe, saved story/capability inspection, sessions
and recording controls, knowledge reading, arc selection, and keyboard focus at
the existing waitlist form. No live waitlist entry is submitted.

The journey runs at 390 px with reduced motion and WebGL disabled, using a 2030
browser clock to prove that the dated sessions remain visible. It also turns the
real WebGL globe at 1440 px and 390 px. Separate existing checks cover 320 px and
390 px page layout, visible keyboard focus, no-script joining, and text enlarged
to 200%. `measurements.json` and `enlarged-measurements.json` hold their readings.
Enlargement is injected text sizing, not native browser zoom.

Reproduce from the repository root with installed Playwright Chromium:

```sh
WEBSITE_SHA=adb06a9152ca1e4a60c060d66844c88fa085ef9f pnpm --filter @storytree/website build
node packages/website/evidence/capture.mjs freeplay --verify-tour --verify-controls --verify-enlarged
pnpm gate
```

On the shared Mint box, each build, capture and gate runs under
`flock /tmp/storytree-heavy.lock`. The scoped gate runs website tests and package
boundaries, workspace typecheck and plan edges. Guidance is not run because no
role or supporting guidance record changed. The test-ratio report is read, not
used as a gate.
