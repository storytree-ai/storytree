# An increment can wait for the owner or an event, with a note — ADR-0938

*Overtaken 2026-10-10 by ADR-0980 ([row-marks](../row-marks/README.md)): the row's count, its waits-on line and the markers beside the chip are gone, so this capture's script no longer passes as written; it is kept as the record of what landed then.*

The actual desktop renderer, captured unedited with headless Chromium 148 over an isolated Postgres
and an explicit fixture. Dark theme, 1440 × 960 at 2× scale. Nothing in the owner's library or running
app is opened or changed.

- [The drawer, resting view](board.png)
- [The lanes, close up](lanes.png)
- [Measured results, including every bar's and marker's hover text](capture.json)

The fixture, top to bottom (the library is asked for its holds as of three days on, through its own
`holds(at)`, so the "tomorrow" check-back below has passed and the others, weeks out, have not):

- *Mobile app* — **queued**: its only open increment waits for an event (yellow bar). The wait line says
  `waits for an event: app store review (check back 2026-10-28)`.
- *Cloud backups* — **queued**: its only open work waits for the owner (yellow, waiting on you). The wait
  line says `waits for you: pick the backup region`.
- *Docs refresh* — **ready · 2 to take**: one increment's event check-back has passed, so it no longer
  holds it. Its bar is grey (open) with a thin yellow ring; hover says
  `check-back passed <day>: the vendor quote arrives`.
- *Website* — **ready · 2 to take**, with a dashed yellow **+2 waiting for approve the DNS cutover and 1
  more** beside the chip: two open increments are held by notes (an owner wait and an event wait), two
  are free.

Measured first: 4 lanes; 1 note marker, on the only ready lane with note-held work; 2 queued lanes, each
naming its note on the wait line and carrying no marker; 1 bar flagged check-back passed of 10 bars; ready
counts exclude the note-held increments (Website 2 of 4 open, not 4).

Principles judged by:

- **Meaning outranks appearance.** A lane with free work and note-held work used to read as plain
  "ready", hiding why two increments were not being taken; a lane held only by notes read "queued" with
  nothing to say what for. Now each says what it waits for, in the owner's own words (the note).
- **One element per signal.** A note wait is a separate signal from an idle claim, so it gets its own
  marker (dashed, yellow, as the held bars are) rather than lengthening the ready chip. A queued lane has
  one wait line for everything it waits on (work first, then notes): the marker is only for a ready lane,
  so nothing says the same thing twice.
- **Legible at the resting view.** The marker's text is read with no hover, wide enough that the first
  note is whole in the capture (a first draft cut it to "approve t…", so the width was raised to 52
  characters; a longer note is cut with an ellipsis, and the full text is in the hover). The check-back
  ring is the weakest signal here: a 1px ring around an 8px bar. It is visible in lanes.png but small; the
  hover says what it means. The owner raises it if it should carry more weight.
- **Yellow means waiting** (the existing bar colours): owner waits and event waits reuse the yellow of
  held questions and waits on work; the passed check-back returns to grey because it no longer holds.

Hover text is a native tooltip, not drawn by headless Chromium: it is the `title` attribute, measured in
capture.json.

Reproduce from the repository root:

```sh
node apps/desktop/build.mjs
node --import tsx packages/arc-surface/evidence/waits-with-a-note/capture.mjs --retake
```
