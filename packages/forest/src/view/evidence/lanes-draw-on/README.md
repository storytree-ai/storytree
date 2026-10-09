# Selection lanes draw on as a lit road

World contracts 6.8 and 6.9 and forest 3.27 (ADR-0951 D2, increment_cba60c6fc59a). The owner, 2026-10-09: "feels like
we could do a better job with the growth animation, its hard to see as its just a thin line inside an already thin
pathway". Now:

- **Width and glow.** A lane fills its road: the road's whole width, or 0.48 of it each where an up and a down lane
  share it, so a hairline of road parts the two colours. A glow in the lane's colour spreads to 2.6 times the lane's
  width at 0.45 opacity, fading towards its edges (the beige roads' halo is 2.4 times at 0.10). The road is not dimmed:
  the lane covers it.
- **A head.** The front brightens towards white (60% at the front, fading over 14 ground units behind it) and widens by
  45% near the front. The head fades out over 0.4 s once the lane is whole. The front is drawn where a fragment's
  distance along the route reaches the lane's drawn length (a shader reading a per-vertex distance), so it sits at its
  exact physical distance wherever it falls between samples.
- **Pacing.** A lane takes 0.6 + length / 300 seconds, kept between 0.8 and 1.8 (it was 0.28 to 1.2), easing out
  (quadratic). Lit lanes start 0.1 s apart (up lanes first, then down lanes, each shortest first), the whole spread kept
  within 1.2 s however many lanes light. Slow frames still advance at most 80 ms.
- **Arrival.** A neighbour's ring pulses in (the existing 0.72 s pulse) when a lane's front is at that island's dock:
  when a down lane arrives there, or when an up lane sets out from there, since an up lane runs from its neighbour to
  the selected island. It is not drawn before. The selected island's own ring does not pulse.
- **Reduced motion.** Every lane is whole at once, with no head, and every ring settled.
- The beige roads' own draw-on (6.16, 6.17, 7.4) keeps its old constant-speed timing.

The owner's scene: storytree's own plan (the [lanes-at-the-coast](../lanes-at-the-coast/README.md) seed, 20 stories),
desktop page in headless Chromium (SwiftShader), 1440 x 960, dark theme, the globe turned to face The library, The map
and Keys; Keys clicked, then The library. 18 lanes light: 1 up (to Keys) and 17 down, 16 of them sharing the trunk
north to The command line. Frames are taken at wall-clock moments after the click; a screenshot takes about 0.7 s in
software rendering, so the moments are uneven, and each frame's JSON gives how far every lane had drawn then.
**Before** is `main` at 2e622633; **after** is this branch.

| | Before | After |
| --- | --- | --- |
| Draw-on strip, the globe's part of each frame | [before-strip.png](before-strip.png): 18 of 18 lanes whole by 0.88 s | [after-strip.png](after-strip.png): 1 whole at 1.0 s, 7 at 1.74 s, 17 at 2.49 s, all by 3.21 s |
| Mid-draw, full size | | [after-frame-2.png](after-frame-2.png) (1.0 s: the trunk's heads climbing north) |
| Reduced motion, first frame after the click | [before-reduced-motion.png](before-reduced-motion.png) | [after-reduced-motion.png](after-reduced-motion.png): all 18 whole, no heads, rings settled |

On the trunk the 16 down lanes start 0.07 s apart over the same road, so mid-draw their heads read as a run of bright
dashes climbing it. The map's ring comes in last (3.21 s), when the longest lane (438 ground units, 1.8 s, starting at
1.2 s) reaches it.

## Reproduce

From the repository root, under the machine's heavy-run lock:

```sh
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/lanes-draw-on/capture.mjs before <main checkout> --retake
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/lanes-draw-on/capture.mjs after --retake
```

Each run builds the desktop page of its checkout with `buildCapture` into ignored `dist/`. Without `--retake`, the
output goes to a scratch folder.
