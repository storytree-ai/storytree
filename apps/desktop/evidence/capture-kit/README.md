# The capture kit, proved on a real capture

`apps/desktop/src/capture` is what a renderer evidence capture imports instead of copying the last
one's harness: `fakeBridge(answers)` (typed against `StorytreeBridge`), `launch()` and
`seedWorkStates(log, project, states)`. `red.txt` and `green.txt` are its unit tests before and after.

It was proved by moving one capture over: `packages/arc-surface/evidence/lane-rollup/capture.mjs`,
run on the Mint box 2026-10-01 with `node --import tsx evidence/lane-rollup/capture.mjs` from
`packages/arc-surface`, after `node apps/desktop/build.mjs`, and with no path set in the environment.

- Its first run through the kit timed out with `ReferenceError: __name is not defined`: tsx compiles
  a function handed to `page.addInitScript` with esbuild's `__name` helper, which the page lacks. The
  kit now hands the page its bridge as text.
- The next run failed after 3.1 s with `the fake bridge does not answer checkForUpdates`, where the
  old harness would have waited 60 s for `data-state=ready`. Then `agentConnections`, then
  `codeSurvey`: the frame's own reads, which the old harness left to fail as read errors on the page.
  The capture now answers them as idle.
- The last run passed every assertion with no page error, on the Chromium Playwright installed for
  itself (148.0.7778.96), found from the checkout: no `/home` path in the capture.
