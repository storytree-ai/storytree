# The sheet opens straight down; pressing Library brings in the tabletop tilt (ADR-1349, contracts 3.52, 3.55)

Mick, by voice 2026-11-16 (voice.note_14131649a346): "Yeah, I think we go with this and see how it feels. The map's 3D
anyway, so unless you've gone from like a completely top-down view, even then you're still gonna see 3D, right?"

What this draws: the glass sheet opens on Stories looking straight down (`opening.png`, 0°). Pressing Library from there eases
in the tabletop tilt, the eye, heading, pan and zoom kept (`library-from-opening.png`, 40°); pressing Stories again moves
nothing (`stories-again.png`, still 40°). From a tilt the user gives by hand neither press moves the eye.

Before this change the sheet opened at the 40° tabletop tilt: #873's `stories-above.png` is that opening.

Kept from #873 (ADR-1340 D1): on the Stories look nothing hangs beneath the glass sheet at any tilt; pressing Library lays the
notes out and hangs them under the clear glass and outlined islands; pressing Stories again lets them go.

storytree's own library (the code-rows seed), then at three tilts set by a real right-drag: from above (40°), side on (85°)
and from below (140°), each on Stories and then on Library. Counted from the scene (`measurements.json`): opening 0°,
Library 40°, Stories again 40°; on Stories 0 notes hung at every tilt, on Library notes hung and shown at every tilt.

Taken by `node --import tsx packages/forest/testing/view/glass-library-look/capture.mjs --retake`.
