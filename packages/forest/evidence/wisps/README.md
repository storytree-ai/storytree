# Volumetric session wisps

Increment `increment_c157825d196c` on arc `arc_895e232031b0` gives the shared engine/session wisp a Blender-authored, 216-triangle model (10,868 bytes): a faceted luminous core, translucent curled shell and soft halo, with its tail trailing the orbit.
The nine-second orbit, session colours, quiet fade, row/wisp hover, invisible hit sphere and reduced-motion positions remain intact; the browser capture checks those interactions, shared model geometry and fading on both layers.
These pictures show the actual desktop renderer with synthetic sessions in headless Chromium/SwiftShader on Linux: the oblique close-up shows the volume most clearly, while globe-distance wisps remain small glowing flames.

- [Globe, three sessions](wisps-globe.png)
- [Globe, hovering a row](wisps-globe-row-hover.png)
- [Globe, hovering a wisp highlights its row](wisps-globe-wisp-hover.png)
- [Close to the ground, hovering a row](wisps-ground-row-hover.png)
- [Single model, very close and oblique](wisps-model-closeup.png)
- [Browser assertions and renderer](capture.json)

```sh
flock /tmp/storytree-heavy.lock ~/.local/bin/blender -b --python packages/forest-world/assets/wisp.blend.py
flock /tmp/storytree-heavy.lock node packages/forest/evidence/sessions-list/build.mjs
flock /tmp/storytree-heavy.lock node --import tsx packages/forest/evidence/wisps/capture.mjs
```
