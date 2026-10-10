# An idle claim does not hide free work — ADR-0938 D3

*Overtaken 2026-10-10 by ADR-0980 ([row-marks](../row-marks/README.md)): the row's count, its waits-on line and the markers beside the chip are gone, so this capture's script no longer passes as written; it is kept as the record of what landed then.*

The actual desktop renderer, captured unedited with headless Chromium 148 over an isolated Postgres
and an explicit fixture. Dark theme, 1440 × 960 at 2× scale. Nothing in the owner's library or running
app is opened or changed.

- [The drawer, resting view](board.png)
- [The lanes, close up](lanes.png)
- [Measured results, including the marker's hover text](capture.json)

The fixture, top to bottom:

- *Arc surface*: a live session holds an increment, so the lane reads **claimed** (a live holder still
  outranks free work).
- *Cloud backups*: its only open increment is held by a session quiet for 42 minutes and nothing is
  free, so it reads **idle · 42 min** and carries no second marker (one chip says it).
- *Docs refresh*: two free increments, no claims: **ready · 2 to take**, nothing beside it.
- *Website*: the real case. One increment held by a session quiet for 859 minutes, three free: it reads
  **ready · 3 to take**, with a small dashed muted **idle · 859 min** beside the chip. Hovering the
  marker names who holds what (`Holds Fix the footer links / Claude Code · window opened … / idle for 859 min`,
  measured in capture.json; headless Chromium does not draw native tooltips).

Measured first: 4 lanes, 2 chips on the Website lane (ready chip + one marker), 1 chip on every other
lane, 0 markers outside ready lanes.

Principles judged by:

- **One element per signal.** The state chip keeps one meaning (what the arc is, here: free work to take);
  the idle claim, a separate signal, gets its own element rather than being folded into the chip's
  text. An idle lane has only its own chip, so nothing says "idle" twice.
- **Meaning outranks appearance.** The Website lane used to read "idle · 859 min", which told the owner
  nothing was takeable while three fixes were free. It now says what is true, ready, and keeps the
  quiet claim visible so it can still be noticed.
- **Legible at the resting view.** The marker is read at the resting view with no hover: its text is a
  few pixels smaller than the chip's and dashed so it reads as secondary, and it stays readable in the
  2× capture (lanes.png). The cost of "small and muted" is that it is the dimmest text in the row; that
  is the intent, and the owner raises it if it should carry more weight.

Reproduce from the repository root:

```sh
node apps/desktop/build.mjs
node --import tsx packages/arc-surface/evidence/idle-beside-ready/capture.mjs --retake
```

(Unlike the lane-roll-up capture, this one needs no snapshot and reads the board through `arcViews`.)
