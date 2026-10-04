# The website teaches on the rebuilt shop (ADR-0890, contracts 2.12 and 2.13)

2026-10-04, Mint box, increment_8254e068412e. `src/shop-snapshot.json` is now the parallel rebuild (project `shop2`, arc_13b5a610cc80): the store the laptop's Claude Code sessions rebuilt two and three at a time, exported by `refresh-shop.ts --project shop2` with health verified from its own CI at each of its 27 stages (4 October 2026, 05:41 to 08:17 UTC). The copy in `packages/app-setup/evidence/shop-parallel/export/` was regenerated with it.

- **Teaching stories:** the cut after the three fixes ("Let's start small") narrows to the rebuild's **Browsing → The cart → Checkout** (`tour-copy.ts`), ringed, with the other five dimmed.
- **8 stories, not 9:** the rebuild folded search into Browsing. No page names the shop's count; the cut's line ("Three of its stories: browse the products, review the cart, check out.") still reads true.
- **The date** on the shop's captions ("replayed from its own records, …" and free play's "recorded …") is now filled at build from the shop's saved window (`{shopDay}`, 4 October 2026), so a later swap cannot leave it stale.
- **Health colour:** the first export of the rebuild drew every island grey, because the code survey read only `src` and the rebuild keeps its tests in `test/`. PR #617 (contract map 8.13) made the survey read tests outside `src`; regenerated, each island's land is coloured by its verified CI health, grey where no numbered test reaches the code.

| Picture | The visitor sees | Likely feels / thinks |
|---|---|---|
| `before-1440-start-small.png`, `before-390-start-small.png` | The first build: nine islands, the long titles ringed ("Browse products and pick them", …), dated 3 October | |
| `after-1440-start-small.png`, `after-390-start-small.png` | The rebuild: eight islands, Browsing, The cart and Checkout ringed, green where CI verified them; dated 4 October | "Fine, something small I already understand": the short names read at a glance |
| `before-1440-freeplay-shop.png`, `before-390-freeplay-shop.png` | Free play on the first build; on a phone the names pile up away from their islands | |
| `after-1440-freeplay-shop.png`, `after-390-freeplay-shop.png` | Free play on the rebuild: eight islands in rows, names beside their islands on a phone too | "Now I can poke around the thing I was shown" |

Browser journeys, on the locally built site (SwiftShader): `--verify-immersive`, `--verify-recording`, `--verify-forest --verify-camera --verify-tour --verify-opening`, `--verify-enlarged`, and the arrival's `arrival`, `turning`, `reduced` and `handoff` all pass. The arrival journey's pinned focus now names the rebuild's three stories.

Clip: `after-arrival.webm`, the arrival at 1× on the live globe, from the pain to the cut to the rebuilt shop (it ends on the cut).
