# A selected session replays its reads, one step at a time (ADR-0797)

Increment `increment_a4a75c459961`. With a session selected, one replay head walks every step of the session in recorded order: each line grows as the head reaches it and each note lights (with its window ring) only on arrival, so the globe shows what the session had read so far. The finished picture holds for 2.5 s, then clears and the replay starts again. No per-agent glow and no per-step fill run while a session is selected. With reduced motion the picture is whole and still, as before. The view with no session selected is unchanged.

- [Selected, reduced motion: every step whole and still](0-reduced-motion.png)
- [Motion on, partway: two steps drawn, the third (dotted) growing; notes further on still unlit](1-mid-replay.png)
- [Motion on, at rest: the finished picture held before it clears](2-at-rest.png)
- [Ten frames about 0.8 s apart: builds, holds, clears (frame 4: the first line growing again), builds again](3-replay-strip.png)
- [What the capture asserted and measured](capture.json)

Measured over 20 samples: steps drawn per sample `2, 4, 4, 5, 5, 5, 1, 3, 3, 5, 5, 5, 5, 1, 2, 4, 4, 5, 5, 5` (of 5). Asserted on every sample: the drawn steps are always the first N of the reading order, and no glow is drawn; across samples the count rises, reaches 5, and falls back (a restart).

The real desktop page in headless Chromium (SwiftShader) on Linux at 2x, over the forest snapshot, with the traversal capture's synthetic session opening six real notes. Motion frames are read from the canvas right after a render (a plain page screenshot can catch SwiftShader's canvas mid-draw).

```sh
node packages/forest/evidence/sessions-list/build.mjs
PLANET_PLAYWRIGHT=file:///…/playwright-core/index.mjs PLANET_CHROMIUM=…/chrome-headless-shell node packages/knowledge-core/evidence/replay/capture.mjs
```
