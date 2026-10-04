# Free play opens on the whole shop, with a project selector (ADR-0890, contract 2.13)

**Amended 2026-10-04 (increment_8254e068412e):** the shop is now the parallel rebuild, with 8 stories; the cut narrows to Browsing → The cart → Checkout. Before and after pictures: `../shop-swap/`.

2026-10-04, Mint box, increment_3018d5393fb6. Skipping or finishing the tour now opens free play on **the whole shop**: all nine of its islands, its roads, and its notes in the core, drawn from `src/shop-snapshot.json` as it is now. A small **Project** selector sits in free play's own row of controls, beside Forest / Library and Find, with two choices: **The shop** (the default) and **storytree**. Choosing storytree switches free play to storytree's own saved project, with everything it had before: story panels, the arcs drawer, the recorded sessions, and storytree's notes in Find. Choosing the shop switches back. Both are saved, dated, read-only readings. The bar says which one is showing ("Free play · an online shop agents built with storytree, recorded 3 October 2026 · read only", or "… storytree's own project, saved … · read only"). The choice lasts only as long as the page: nothing is stored. A switch closes whatever panel was open and frames the new globe whole.

On the shop, Find lists the shop's islands and notes. The story panel, the arcs and the recorded sessions stay with storytree's project: the shop's saved growth has no plan, arcs or activity to show in them (parked on the arc for the rebuilt shop's data). Without WebGL, storytree's still never stands in for the shop.

| Picture | The visitor sees | Likely feels / thinks |
|---|---|---|
| `freeplay-shop-1440.png`, `freeplay-shop-390.png` | The shop they just learned on, whole, with its nine islands named; "The shop" is lit in the selector | "Now I can poke around the thing I was shown" |
| `freeplay-storytree-1440.png`, `freeplay-storytree-390.png` | After choosing storytree: storytree's busy globe, with the arcs bar, the sessions tray and Find | "And this is the real, big one": curiosity for those who want the depth |

Phone: on the shop, the globe's nameplate layout pushes several names away from their islands at 390 px. This is the defect parked on the arc from increment_24f45ba457c7, in packages/forest.

Browser journeys: `--verify-tour` (2.6 and 2.13 without WebGL: opens on the shop, its still hidden and storytree's sessions not shown, then switches to storytree and opens a story, a note, the arcs and the sessions) and `--verify-immersive` (2.13 at 1440, 390 and 320: opens on the whole shop with the selector inside the viewport and 44 px phone targets, then switches to storytree's story panel) pass.
