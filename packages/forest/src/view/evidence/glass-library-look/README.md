# The library's notes hang under the glass only while Library is pressed (ADR-1340 D1, contract 3.55)

Mick, by voice 2026-11-15 (voice.note_5a0adc01122c): "I think it's something that should be within reach, but we don't
need to stress out our performance by loading it fresh every time, because it's a lot of dots to render and maintain
position on."

What this draws: on the Stories look nothing hangs beneath the glass sheet at any tilt, so turning the map lays out, keeps
in position and draws no note; pressing Library lays the notes out and hangs them under the clear glass and outlined
islands, as before. Pressing Stories again lets them go. Neither press moves the eye (ADR-1062 D3, unchanged).

storytree's own library (the code-rows seed) at three tilts set by a real right-drag: from above (40°), side on (85°) and
from below (140°), each on Stories and then on Library. Counted from the scene (`measurements.json`): on Stories 0 notes
hung at every tilt (before this change the notes were hung there too, and shown from side on and from below); on Library
754 hung and shown at every tilt.

Taken by `node --import tsx packages/forest/testing/view/glass-library-look/capture.mjs --retake`.

In the evidence bucket for #873, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `873/library-above.png`, `873/library-below.png`, `873/library-side-on.png`, `873/stories-above.png`, `873/stories-below.png`, `873/stories-side-on.png`, `873/measurements.json`.
