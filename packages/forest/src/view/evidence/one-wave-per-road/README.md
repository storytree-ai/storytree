# A lit road carries one wave, with a softer head

World contract 6.9 (ADR-1000, increment_4287031cd881). The owner, 2026-10-11: "I like the waves but its quite
overwhelming when theres a lot of them", then: "Go with \"One wave per road\" with the softer head for the pathway
waves." Now:

- **One pace.** Every lane of a selection starts on the click and its front moves at 250 ground units a second, with no
  ease, so fronts sharing a road travel as one. A lane's time is its length over that pace, and the selection settles
  in its longest lane's time however many links light. (It was: each lane 0.6 + length / 300 seconds within 0.8–1.8,
  easing out, the lanes starting 0.1 s apart within 1.2 s.)
- **One head per shared stretch.** Each stretch of route of one colour is led by the lane whose front reaches it first;
  a lane's head shows only along the stretches it leads, so a follower is headless along a trunk already lit and its
  head grows in over 3 ground units where it turns off alone. A wave splits at a fork and merges at a join. An up and
  a down lane on one road each keep their own half, and their own head.
- **A softer head.** Tinted towards cream `#ffe2b0` at 0.55 at the front (it was white at 0.6), widening the lane by 20%
  (it was 45%), fading over 34 ground units behind the front (it was 14), and lifting the glow's opacity by 1.0 times
  at the front (it was 1.5). The sketch's 0.42 read too faint on the violet trunk in software rendering, so the mix was
  raised to 0.55: lamplight, not a white spark. The head still fades over 0.4 s once its lane is whole.
- **Kept.** Routes, widths, glows, colours and end marks are unchanged; slow frames advance at most 80 ms; reduced
  motion shows every lane whole at once with no head.

The owner's scene: storytree's own plan (the [lanes-at-the-coast](../lanes-at-the-coast/README.md) seed), desktop page
in headless Chromium (SwiftShader), 1440 x 960, dark theme, the globe turned to face The library, The map and Keys;
Keys clicked, then The library. 18 lanes light: 1 up (to Keys) and 17 down, most sharing the trunk north to The command
line; the longest is 756 ground units. The page runs on Playwright's clock, paused and run forward to each moment, so
each frame is at exactly its moment. "Heads" counts lanes whose head shows (brightness over 0.05).
**Before** is `main` at a942f16f; **after** is this branch.

| Moment after the click | 0.2 s | 0.5 s | 0.8 s | 1.2 s | 1.6 s | 2.2 s | 2.8 s | 3.6 s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Heads before | 3 | 7 | 12 | 17 | 18 | 15 | 9 | 0 |
| Heads after | 5 | 2 | 3 | 4 | 2 | 3 | 2 | 0 |
| Lanes whole before | 0 | 0 | 0 | 0 | 1 | 7 | 15 | 18 |
| Lanes whole after | 0 | 0 | 0 | 2 | 5 | 15 | 17 | 18 |

Both settle in about 3 seconds (3.0 s before, 3.02 s after). The after build's five heads at 0.2 s are lanes leaving
five different territories inside The library; they merge as they reach its dock, and from then on one head climbs the
trunk.

| | Before | After |
| --- | --- | --- |
| Draw-on strip, the globe's part of each frame | [before-strip.png](before-strip.png) | [after-strip.png](after-strip.png) |
| Mid-draw, full size | | [after-frame-2.png](after-frame-2.png) (0.5 s: one warm head climbing the trunk) |
| Reduced motion, first frame after the click | | [after-reduced-motion.png](after-reduced-motion.png): all 18 whole, no heads |

## Reproduce

From the repository root, under the machine's heavy-run lock:

```sh
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/one-wave-per-road/capture.mjs before <main checkout> --retake
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/one-wave-per-road/capture.mjs after --retake
```

Each run builds the desktop page of its checkout with `buildCapture` into ignored `dist/`. Without `--retake`, the
output goes to a scratch folder.
