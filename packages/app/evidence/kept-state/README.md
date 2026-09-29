# The app shows its last known state at once while it refreshes

The owner, 2026-09-29: "we should be displaying prev state while the app refreshes, this way the user
at least can orient on something during the load" (`increment_12f64f90f42f`).

These are unedited headless-Chromium screenshots of the **real desktop renderer bundle** (`apps/desktop/dist`,
1440 × 960) and the app's real page reads over a throwaway Postgres with a small made-up project.
The next launch is modelled as a fresh page carrying the first page's storage, with the library's
live reads held back (slow) or refused (failing). `capture.mjs` asserts each step.

| Shot | What it shows |
|---|---|
| [0-first-launch-fresh.png](0-first-launch-fresh.png) | First launch: nothing kept, so it loads as before, then keeps the tree, board and session rows it drew. |
| [1-next-launch-kept-state.png](1-next-launch-kept-state.png) | Next launch, library not answering yet: the arcs drawer, session list and forest are drawn from what was kept. Each is marked "as last read… refreshing", and the page's `data-state` is still `loading`. |
| [1b-next-launch-kept-forest.png](1b-next-launch-kept-forest.png) | The same launch with the drawer closed: the kept forest's three islands. |
| [2-refresh-failing-keeps-kept-state.png](2-refresh-failing-keeps-kept-state.png) | A launch whose reads fail: the kept state stays on show with the error, with no error screen in its place. |
| [3-library-back-fresh.png](3-library-back-fresh.png) | The same page once the library answers: fresh, with the marks gone and no reload. |

While the board is refreshing, it shows no agents, because the agent log's lines are not kept.
That is why the lane says "quiet" in shot 1 and "claimed" in shot 3.

Run it after `node apps/desktop/build.mjs`:
`STORYTREE_EMBEDDER=off STORYTREE_PLAYWRIGHT=<playwright-core index.mjs as a file URL> node --import tsx packages/app/evidence/kept-state/capture.mjs`
(on Windows, also give `STORYTREE_CHROMIUM` unless Playwright's own Chromium is installed).
