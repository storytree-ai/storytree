# Session wisps orbit their islands

Increment `increment_46fce9595005`, arc `arc_895e232031b0`, decision ADR-0736 (`decision_e5e6c98e01fd`, owner-directed 2026-09-28: "orbit the island, replace the dots, colour per session").

Each session with a row in the running-sessions list is one wisp orbiting the island of each story it holds a claim in. The claim dots of ADR-0730 are gone. A session's colour is the same on its wisps and on its row's swatch, and is never green or the "needs you" amber. Hovering a row swells its wisps and lights its islands; hovering a wisp highlights its row (and lights its islands the same way). A quiet holder with hooks fades. A subagent folded under its parent orbits only through its parent's wisp; an ended session and a session with no row draw none.

Behaviour ported from 0.2 (ADR-0212's claim-wisp family), not code: the orbit takes nine seconds, starts at a phase fixed per session, and sits just outside the island's reach. The body is the engine's own wisp drawing (`WispBody` in `@storytree/forest-world/canvas`, which the engine's `WispSprite` now also uses), tinted by the session colour. Under reduced motion the wisps hold still at their phase. The overlay works in a plate's local ground, so the same component draws on a globe plate and on flat ground; 0.3's page mounts only the globe (ADR-0655), so the close-up picture is the globe zoomed onto a plate.

## Pictures

- [Globe, three sessions](wisps-globe.png)
- [Globe, hovering a row](wisps-globe-row-hover.png)
- [Globe, hovering a wisp highlights its row](wisps-globe-wisp-hover.png)
- [Close to the ground, hovering a row](wisps-ground-row-hover.png)
- [Browser assertions and renderer](capture.json)

Renderer: Playwright's headless Chromium with SwiftShader on Windows. The page is the actual desktop renderer over a prior read-only forest snapshot; all session activity is synthetic.

```sh
node packages/forest/evidence/sessions-list/build.mjs
PLANET_PLAYWRIGHT=<playwright-core index.mjs> PLANET_CHROMIUM=<chrome-headless-shell> node packages/forest/evidence/wisps/capture.mjs
```
