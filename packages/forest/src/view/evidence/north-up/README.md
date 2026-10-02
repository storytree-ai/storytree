# North stays up

The globe now turns only by spin (about its own poles, without limit) and tilt (toward either pole, held
at 88°, just short of it). The eye no longer orbits: it only zooms. The opening view and a hidden-failure
marker's click are the same spin and tilt, so nothing rolls the globe and north points straight up the
screen after any sequence of moves.

Captured on the actual desktop page (`node build.mjs`, then `node --import tsx capture.mjs dist after`), with the
knowledge-under-islands seed and the file-circles survey, 1440 × 960, headless Chromium on SwiftShader.
The before pictures are origin/main bundled the same way (`CAPTURE_ROOT=<main checkout> CAPTURE_DIST=dist-before
node build.mjs`, then `node --import tsx capture.mjs dist-before before`). The drags are real pointer drags from the
canvas's middle: 90 px right; 70 px down; 140 px left and 50 up; 70 right and 40 down; then 700 up.

North's bearing on screen, in degrees clockwise from straight up (`*-measurements.json`):

| after | before (main) | after (this branch) |
|---|---|---|
| opening | 0 | 0 |
| drag 90, 0 | −23.0 | 0 |
| drag 0, 70 | −31.1 | 0 |
| drag −140, −50 | 7.6 | 0 |
| drag 70, 40 | −2.7 | 0 |
| drag 0, −700 | −171.8 (upside down) | 0, tilted 88° and held there |

- [Opening](after-opening.png) · [before](before-opening.png)
- [After four drags](after-four-drags.png) · [before](before-four-drags.png)
- [A long drag up stops just short of the pole](after-tilted-to-the-pole.png) · [before: the globe turned over](before-tilted-to-the-pole.png)
