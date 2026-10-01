# A note several sessions read shows each of them (ADR-0754 D2)

Increment `increment_5152f00ef163`. With no session selected, a note more than one listed session has read keeps its dot in the colour of the session that read it last, and gains a thin ring split into one arc per session that read it, each in that session's colour, in the order they first reached it (clockwise from the top). A session's arc appears only once its reading line reaches the note (ADR-0742 D2, resteer_15a023fe6573); until then the dot keeps the previous reader's colour. ADR-0738 D3's white "shared" halo is gone. The inside view draws the same ring.

- [Overview: three sessions converging on two notes](converged-overview.png)
- [Close: a note all three read, first builder (cyan), then the app review (violet), then the library check (orange), which read it last](converged-close.png)
- [Close: the same three, but the app review read it last](converged-close-latest-b.png)
- [A new read on its way: the builder reads a note only the app review had; its line is still growing, so the dot is still violet and there is no ring](arrival-growing.png)
- [The line arrives: the dot turns cyan and the ring shows violet then cyan](arrival-reached.png)
- [What the capture asserted](capture.json)

The real desktop page in headless Chromium (SwiftShader) on Linux at 3x, over the forest snapshot with three synthetic sessions reading real shelf-placed notes; the close pictures are 240 by 160 pixel crops around the note.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node --import tsx packages/knowledge-core/evidence/shared-note/capture.mjs
```
