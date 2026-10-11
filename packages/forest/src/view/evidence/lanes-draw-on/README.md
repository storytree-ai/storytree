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
north to The command line. The page runs on Playwright's clock, paused at the click and run forward to each moment
(0.15, 0.4, 0.7, 1.0, 1.4, 1.9, 2.6 and 4.0 s), so each frame is at exactly its moment however slow software rendering
is, and each frame's JSON gives how far every lane had drawn then. The strip's crop is placed by The library's point on
screen, so both builds show the same lanes. **Before** is `main` at 2e622633; **after** was this branch, re-captured
on 2026-10-11 from `main` at 93eeaead, whose pacing is [one wave per road](../one-wave-per-road/README.md)'s
(world 6.9, ADR-1000), not the paragraph's above.

| | Before | After |
| --- | --- | --- |
| Draw-on strip, the globe's part of each frame | [before-strip.png](before-strip.png): 2 of 18 lanes whole at 0.4 s, 17 at 0.7 s, all by 1.0 s | [after-strip.png](after-strip.png): 1 whole at 1.0 s, 4 at 1.4 s, 9 at 1.9 s, 17 at 2.6 s, all by 4.0 s (the longest, 756 ground units, at 3.02 s) |
| Mid-draw, full size | | [after-frame-2.png](after-frame-2.png) (0.4 s: the trunk's head climbing north) |
| Reduced motion, first frame after the click | [before-reduced-motion.png](before-reduced-motion.png) | [after-reduced-motion.png](after-reduced-motion.png): all 18 whole, no heads, rings settled |

Under one wave per road the down lanes all start on the click and climb the trunk as one front; the selection settles
when the longest lane (756 ground units, 3.02 s) is whole.

## Reproduce

From the repository root, under the machine's heavy-run lock:

```sh
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/lanes-draw-on/capture.mjs before <main checkout> --retake
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/lanes-draw-on/capture.mjs after --retake
```

Each run builds the desktop page of its checkout with `buildCapture` into ignored `dist/`. Without `--retake`, the
output goes to a scratch folder.
