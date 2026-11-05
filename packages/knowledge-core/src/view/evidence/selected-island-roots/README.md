# A selected island's notes: no link web, the rest faded, lit balls on hairline roots (ADR-1260)

The real desktop page on storytree's own map (the code-rows seed), The knowledge core's island clicked, then the sheet tilted
by a real right-drag, the camera left still. Each tilt is shot on the smoked glass and again under the Library button's
clear glass, from `main` (before) and from this branch (after).

What changed (contracts 1.11 and 1.15):

- **No link lines.** Selecting a story no longer draws the web of its notes' links (ADR-1061 D3, narrowed by ADR-1260 D1).
- **Roots.** Each of the selected story's notes hangs on a one-pixel, low-opacity line straight up to the sheet, so where it
  sits under the island and how deep it hangs read without rotating; no other note has one.
- **The rest faded back.** Other stories' notes are drawn at about 0.06 opacity at rest, down from 0.18: faded, not hidden.
- **Lit balls.** Under the sheet each dot is a sphere lit by the sheet's own soft light and lamp, keeping its colour and size.

Pictures, 1440 x 960:

- `before-side-on.png`, `after-side-on.png`: tilted to 80 degrees, smoked glass.
- `before-side-on-library.png`, `after-side-on-library.png`: the same, clear glass.
- `before-below.png`, `after-below.png`: seen from below, smoked glass.
- `before-below-library.png`, `after-below-library.png`: the same, clear glass.
- `*-library-close.png`: each clear-glass view again with the eye zoomed three times, so a ball's shading and a root read.

Taken with `node --import tsx packages/knowledge-core/testing/traversal-when-selected/build.mjs <checkout> before|after`, then
`node --import tsx packages/knowledge-core/testing/selected-island-roots/capture.mjs before|after --retake`, which also
counts from the scene the links and roots drawn, the shaded dots, and the faintest and brightest dot into
`before-measurements.json` and `after-measurements.json`.
