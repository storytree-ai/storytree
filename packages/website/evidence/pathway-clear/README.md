# The stories step's pathway tag stands clear of the islands (increment_f7ae1afd5735)

Map line 5 of the stories step, "a pathway: the cart needs signing in", captured with
`node packages/website/evidence/arrival/capture.mjs --only mapLabels` at 1920, 1440, 1280, 390 and 320. Before: main's
build (`--dist`) on 2026-10-12. After: this branch's build.

- Before: at 1920, 1440 and 1280 the words sat above the ring, over the Cart island. At 390 they sat over the tops of the Cart and Checkout islands.
- After: the globe reports each drawn island's screen box (forest 3.51). A tag keeps off every island except the one it points into, treating them as hard boxes (website 2.24). A pathway points into none. Above or below its ring, a tag may also step out by half a ring or a whole one. At 1920, 1440 and 1280 the words now sit below the Cart name, clear of both islands and both names. At 390 they sit above the islands, clear of the globe's note, which now joins the keep-out list.
- 320: the pathway tag hides below 390 (`narrowest: 390`), so neither picture shows it.

Every other map label shows no change against main's build, apart from SwiftShader's frame-to-frame noise.
