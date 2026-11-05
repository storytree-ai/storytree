# Toggling the sidebar draws the map without a flicker (contract 4.43)

The real desktop page on the eight-story forest map, 1440 x 900, the sidebar hidden and shown again with Ctrl+B while
Chrome's screencast kept every frame it painted, the map's motion reduced so little else moves.

Mick, from the desktop app, 0.3.2498: "Using the hide sidebar causes flicker of the map". What it was, measured frame by
frame on main: the canvas's root watched its frame's size through a 50 ms debounce, so for about four frames after the
sidebar hid the canvas kept its old width, drawn against the frame's new left edge, with a bare strip down the right and a
nameplate left hanging in it; shown again, the picture slid right under the sidebar and the compass went, then each
snapped back. With the debounce gone, the canvas was drawn for a frame at its new size posed for the old one (half the
sidebar's width off), until #490's correction arrived through React.

Now the canvas takes its frame's new size in the browser's resize step, between laying the page out and painting it, and
is drawn there, with the eye keeping its zoom and the place under the edge that did not move in the same store update.

- `before-frames.png`: main. Frame 0 as it opened; 6, the sidebar hidden, the map still at its old width; 7, put right;
  14, the sidebar shown, the map slid right and the compass gone; 16, put right.
- `after-frames.png`: this change. Frame 0 as it opened; 3, the sidebar hidden, the islands where they were; 9, shown
  again, as it opened. No frame in between.

Measured, `frames.json`'s `acrossTheMap`: the frames that changed most of the page from the one before, for two toggles.
Main: 4. This change: 2, one per toggle. What else still moves (a lit stretch of road, the compass) changes under 300
pixels across.

Taken with `node --import tsx packages/forest-world/testing/frame-resize/capture.mjs after` (and `before`, with main's
`PlanetWorldCanvas.tsx` and `sheet.tsx` in place); the two pictures are each run's frames that changed most of the page,
in order, beside its first.
