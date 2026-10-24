# The Library button changes the look, never the view

Increment `increment_30faf3e3c7fb`, arc `arc_ea0f2a347b65`, decision ADR-1062 D3 as the owner amended it: "clicking the
library button should just make the glass see through and the islands turn transparent and just show their outline. the
user controls the rotation not the buttons."

- **Library** clears the glass and turns every island into its outline; the nameplates stay, and the knowledge graph beneath
  shows from every angle, from straight above included.
- **Stories** brings back the smoked glass and solid islands. From well above the smoked glass hides the graph; tilted
  toward level or below it shows (D4).
- **Neither moves the eye.** Tilt, spin, pan and zoom stay exactly where the user left them; the 0.9 s swing and the T key are
  gone. Which button is pressed follows only the press, never the angle the user tilts the sheet to.

Each pair is the same view, tilted there by a real right-drag, then a real press of Library (and of Stories again, which
returned the eye and the sheet to the same placement to four decimal places: `capture.mjs` asserts it at each tilt).
Drawn by the actual desktop page, 1440 × 960, dark theme, headless Chromium (SwiftShader), from the capture kit's `code-rows`
seed (storytree's own library). Beside the build it amends: `../glass-table/`.

| | Stories | Library |
| --- | --- | --- |
| From above (40°) | ![](https://github.com/storytree-ai/storytree/raw/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look/stories-above.png) | ![](https://github.com/storytree-ai/storytree/raw/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look/library-above.png) |
| Side on (85°) | ![](https://github.com/storytree-ai/storytree/raw/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look/stories-side-on.png) | ![](https://github.com/storytree-ai/storytree/raw/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look/library-side-on.png) |
| From below (140°) | ![](https://github.com/storytree-ai/storytree/raw/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look/stories-below.png) | ![](https://github.com/storytree-ai/storytree/raw/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look/library-below.png) |

`measurements.json` has each view's tilt, the glass's opacity (0.72 smoked, 0.05 clear), the notes on show and the islands
drawn filled or as outlines. `capture.mjs --smoke` is the real-browser test 3.55 in `../../desktop-renderer-smoke.test.ts`.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 6 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/glass-library-look).
