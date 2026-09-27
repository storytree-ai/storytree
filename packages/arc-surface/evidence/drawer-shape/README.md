# Arc drawer shape — ADR-0660 D1–D3

The actual desktop renderer, captured unedited with headless Chromium over an isolated
Postgres. The supplied owner snapshot has 1,307 records and **no arcs or questions** (it predates
plan cutover). It supplies the real forest beneath the drawer; explicitly created fixture arcs
exercise waiting, claimed, quiet, queued, parked and closed states. The temporary database is
removed after capture, and the source snapshot and live library are never changed.

- [Closed: centered top-edge handle](drawer-closed.png)
- [Open: dense two-line rows](drawer-open.png)
- [Queue: chips beneath the blocker](queue-expanded.png)
- [Question: reading replaces the list](question-reading.png)
- [Measured acceptance results](capture.json)
- [Initial failing rendering tests](red.txt)
- [Multi-queue smoke regression reproduced before its fix](queue-smoke-red.txt)
- [Pending library text patch and supervisor checklist](library-update/README.md)

The browser asserts top-edge/half-height geometry, row heights, a real pointer event received
by the forest below the drawer, initial queue hiding and nested chip placement, question list
swap/back, and remembered open/scope/selected arc in a fresh browser context with saved local
storage. A second reload proves remembered closed state. The fixture has two parked arcs so
saved selection cannot pass by accidentally choosing the only candidate.

It also retains #112’s live claim, clock-only idle, failed-read retry, live settlement and
read-only-history checks, while preserving the open question, queue, fold and scroll position
through a live refresh. The smoke check opens multiple queues in every scope and judges the
root rows/bars/holders and queue chips through `document.body.dataset.drew.arcSurface`.
Hidden descendants represented by +N are not claimed as drawn rows. The desktop has a one-line
composition seam to keep each mounted surface’s census when the forest redraws; persistence
uses existing Electron local storage and adds no app service.

Reproduce from the repository root, using the existing #112 harness:

```sh
flock /tmp/storytree-heavy.lock node apps/desktop/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/arc-surface/evidence/capture.mjs
```

`ARC_SNAPSHOT`, `ARC_PLAYWRIGHT` and `ARC_CHROMIUM` override the supplied snapshot, installed
Playwright module and Chromium executable. Defaults name this Mint box’s installations.
The browser, HTTP server and throwaway database are closed in `finally`.

The first browser attempt exposed stale #112 harness wiring: the current renderer requires
`projectSelection`, which the old harness did not expose. Updating that bridge enabled the
acceptance; it was not evidence of missing drawer behavior. The committed red proof is the
two rendering behavior tests, followed by the separately reproduced multiple-queue regression.

0.2 was read only. Its Library switch and artifact links are omitted by ADR-0660 D2/D3;
drag resizing was outside this increment. No fresh decision was written.
