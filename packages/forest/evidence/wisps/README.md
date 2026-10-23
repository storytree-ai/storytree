# Volumetric session wisps

**Retired look (2026-10-02).** The wisps went in commit 06cbfc8b: a running session now tints its islands' coasts and claimed territories instead (see `../../src/view/evidence/session-tints`). Its capture script was deleted with this note, since there is nothing left on the page for it to check; the pictures and measurements below are the record of what landed then.

Increment `increment_c157825d196c` on arc `arc_895e232031b0` gives the shared engine/session wisp a Blender-authored, 216-triangle model (10,868 bytes): a faceted luminous core, translucent curled shell and soft halo, with its tail trailing the orbit.
The nine-second orbit, session colours, quiet fade, row/wisp hover, invisible hit sphere and reduced-motion positions remain intact; the browser capture checks those interactions, shared model geometry and fading on both layers.
These pictures show the actual desktop renderer with synthetic sessions in headless Chromium/SwiftShader on Linux: the oblique close-up shows the volume most clearly, while globe-distance wisps remain small glowing flames.

- [Globe, three sessions](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/wisps/wisps-globe.png)
- [Globe, hovering a row](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/wisps/wisps-globe-row-hover.png)
- [Globe, hovering a wisp highlights its row](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/wisps/wisps-globe-wisp-hover.png)
- [Close to the ground, hovering a row](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/wisps/wisps-ground-row-hover.png)
- [Single model, very close and oblique](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/wisps/wisps-model-closeup.png)
- [Browser assertions and renderer](capture.json)

```sh
node packages/dev-loop/src/heavy-lock.mjs -- ~/.local/bin/blender -b --python packages/forest-world/assets/wisp.blend.py
node packages/dev-loop/src/heavy-lock.mjs -- node packages/forest/evidence/sessions-list/build.mjs
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/evidence/wisps/capture.mjs
```

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 5 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/evidence/wisps).
