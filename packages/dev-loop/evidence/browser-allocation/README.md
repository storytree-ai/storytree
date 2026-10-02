# Measured browser allocation (contract 6.5)

`@storytree/dev-loop/browser-coverage` exposes `recordBrowserCoverage`. A story's
capture passes its package directory, an own-story-prefixed numbered proof (for
example `forest-world 1.1 …`), whether it passed, and precise V8 scripts. Each
script supplies `functions` and `source` from Playwright's `stopJSCoverage()`, the
matching `sourceMap`, and `bundlePath`, the local generated bundle path against
which map sources resolve. Only executed source functions inside that package
contribute. A foreign proof prefix is refused.

The recorder replaces that proof's contribution in `survey-browser-coverage.json`
beside the package's `src`. A failed or unexecuted recapture removes its previous
input. Run `pnpm survey:coverage <package>` afterward and commit both JSON files:
Node regeneration combines its passing test coverage with these measured browser
inputs into `survey-coverage.json`, which the survey already reads. Raw capture
records and assertions remain with the owning story's evidence.

`capture.mjs` runs Chromium against a temporary source-mapped two-function bundle.
The clicked function returns 42 and counts once; the idle function counts zero.
`browser.json` preserves its actual V8 records and the equal before/after
regeneration maps. Reproduce from the repo root with
`node packages/dev-loop/evidence/browser-allocation/capture.mjs` under the heavy-run
lock, with Playwright Chromium installed. This allocates only the temporary
fixture; it does not claim the forest, world, website or desktop source.

The portable regression in `survey-coverage.test.mjs` executes a real source-mapped
Node bundle, additionally proving foreign-source exclusion, repeat replacement,
failed recapture invalidation, and preservation alongside regenerated Node tests.
It failed first on the missing public entry. The existing child-process regression
also failed first because a failed test's executed function was incorrectly counted.
