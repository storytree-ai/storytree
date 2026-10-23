# One road type: every road and lit lane is drawn solid

Increment `increment_1e72bfc61e40`, by the owner's direction of 2026-10-11 on seeing the dashed look
(`resteer_354c8423f114`): "just have the one road type which is solid". World 6.8. These are pictures for the owner to
look at. Nothing here is recorded as accepted (ADR-0794).

Before (main, 021c91cc), a road carrying a type-only link was dashed, and a road shared with links by value was dashed
at its full width round a solid core; a lit type-only lane and its glow were dashed too. Now every road is one solid
ribbon at its full width, and every lit lane and glow is solid, whatever its links. The survey still marks an edge
type-only (ADR-0991 D1) and the scene still carries it (`typeOnly` on a link and lane, `typeOnlyLinks` on a segment, kept
in each mesh's userData); only the drawing stopped using it. Lanes inland along the territory borders are unchanged.

| View | Before (main) | After (this branch) |
| --- | --- | --- |
| Nothing selected, The library facing | [before-unlit.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/before-unlit.png) | [after-unlit.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/after-unlit.png) |
| Nothing selected, close up | [before-unlit-close.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/before-unlit-close.png) | [after-unlit-close.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/after-unlit-close.png) |
| The library selected | [before-the-library-selected.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/before-the-library-selected.png) | [after-the-library-selected.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/after-the-library-selected.png) |
| The library selected, close up | [before-the-library-close.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/before-the-library-close.png) | [after-the-library-close.png](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type/after-the-library-close.png) |

**Measured** (the `.json` beside each picture): 75 road segments, 54 of them carrying a type-only link, before and after.
Solid cores drawn down a shared road: 52 before, 0 after. The library selected: the same 135 lanes, 90 of them
type-only, now drawn like the rest. Frame time (median of 25 frames, headless Chromium on SwiftShader, so only the
comparison means anything): nothing selected 4.2 ms before, 3.4 ms after; The library selected 11.1 ms before,
13.9 ms after (one run each; software drawing jitters by a few milliseconds).

## Rerun

Renderer: headless Chromium, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1, with ../derived-roads' seed
and survey. From this folder: `node --import tsx build.mjs <main checkout> before`,
`node --import tsx build.mjs <this checkout> after`, then
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs before|after --retake`.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 8 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/one-road-type).
