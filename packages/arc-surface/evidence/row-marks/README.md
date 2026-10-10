# An arc's row is its chip, its title, two counted marks and wrapping bars — ADR-0980

The actual desktop renderer, captured unedited with headless Chromium 148 over an isolated Postgres
and an explicit fixture. Dark theme at 2× scale. Nothing in the owner's library or running app is
opened or changed.

- [The drawer, 1440 wide](board.png)
- [The lanes, close up](lanes.png)
- [A 640-wide window: the long arc's bars wrap](narrow.png)
- [Measured results, including every mark's hover and label](capture.json)

The fixture, top to bottom:

- *Website* — **waiting** (an open question): ⌛ 1 (an event note, payment provider review) and ? 2 (the
  open question and an owner note, approve the DNS cutover).
- *Cloud backups* — **queued**: ⌛ 1 (two increments wait on one increment in the Platform arc, counted
  once) and ? 1 (an owner note, pick the backup region).
- *Docs refresh* — **ready · 1 to take**: nothing to count, so no marks.
- *Platform rebuild* — **ready · 7 to take**, 34 increments under a long title: 26 landed, 1 failed, 7
  open. The title ends in an ellipsis before the row's edge at 640 wide; the bars wrap onto a second
  line there.

Measured first, for every lane: line two holds the bars alone; every bar is 8 × 10 px, wrapped or not; no
bar is drawn beside or over line one; the marks sit to the right of the title; each mark's accessible
label equals its hover. The count is the bars' label only (Platform: "Increments: 26 landed · 1 not
completed · 7 open"), never drawn.

Principles judged by:

- **The row is for the glance, the panel for reading** (the owner, 2026-10-10: "the arc surface is not
  meant for reading prose"). Every sentence the row used to carry is now a mark's hover, so nothing is
  lost, only moved off the glance.
- **One element per signal.** The hourglass counts what the work waits on that is not the owner; the
  question mark counts what waits on the owner. The colour is the waits' yellow.
- **Nothing overlaps.** The bars take the full width and wrap at their own size, rather than shrinking or
  sharing a line with text.

Hover text is a native tooltip, not drawn by headless Chromium: it is the `title` attribute, measured in
capture.json.

Reproduce from the repository root:

```sh
node apps/desktop/build.mjs
node --import tsx packages/arc-surface/evidence/row-marks/capture.mjs --retake
```
