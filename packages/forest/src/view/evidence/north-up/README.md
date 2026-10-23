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

- [Opening](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up/after-opening.png) · [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up/before-opening.png)
- [After four drags](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up/after-four-drags.png) · [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up/before-four-drags.png)
- [A long drag up stops just short of the pole](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up/after-tilted-to-the-pole.png) · [before: the globe turned over](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up/before-tilted-to-the-pole.png)

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 6 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/north-up).
