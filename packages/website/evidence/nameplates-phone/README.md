# On a phone, each island's name sits by its island (forest 3.31)

2026-10-04, Mint box, increment_7129ebe0d6d4. On the shop's globe at phone widths the story names stepped down the
screen to clear each other by up to 140 px, the same as on a desktop, though the phone's globe is a third the size.
In the cut to the shop's three teaching islands, "Review the cart and use the menu" sat 113 px under its ring, by
another island. Two rules now hold in `packages/forest` (`settlePlates` in `src/view/nameplates.ts`):

- A dimmed name (an island outside the cut's focus) settles after the names in focus, so it moves or hides, not them.
- A name steps no further than a third of the globe's radius on screen (and never past 140 px). On a phone (radius
  about 173 px) that is about 58 px; past it, a name hides. On a desktop's globe (about 430 px) the bound stays 140 px.

Captured from the built site (`pnpm --filter @storytree/website build`, then `node capture.mjs before|after`),
headless Chromium on SwiftShader. Before is origin/main at 5b4b3ae8. `measurements-*.json` has every name's box
where it hangs and where it settled.

| How far each name sits from where it hangs, px | 390 cut, before | 390 cut, after | 390 free play, before | after |
|---|---|---|---|---|
| Browse products and pick them (in focus) | 0 | 0 | 0 | 0 |
| Review the cart and use the menu (in focus) | **113** | 0 | **122** | 0 |
| Check out (in focus) | 0 | 9 | 0 | 4 |
| See my orders | **117** | 26 | **117** | 17 |
| Review products | **125** | 34 | **130** | 29 |
| Manage stock and prices | 0 | hidden | 0 | 45 |
| Sign up for an account | 57 | hidden | 57 | hidden |
| Sign in and see the products | hidden | hidden | hidden | hidden |

At 1440 every name settles exactly as before, in the cut and in free play (same steps: 66, 23, 25; nothing hidden).
At 320 the cut had hidden "Browse products and pick them", a name in focus; it now shows all three teaching names.
In free play at 320 one of nine names is still hidden before and after (Browse before, Review products after).

| Picture | The visitor sees | Likely feels / thinks |
|---|---|---|
| `before-390-cut.png` → `after-390-cut.png` | The three ringed islands each with its own name under it; the dimmed names quiet beneath | "Those three are the ones it's talking about" |
| `before-390-freeplay.png` → `after-390-freeplay.png` | Nine names down the column, each by its island; one dropped where there is no room | "I can read the shop at a glance; pinch to see more" |
| `before-1440-cut.png` / `after-1440-cut.png`, and the free-play pair | The same desktop picture | Unchanged |
| `before-320-*.png` / `after-320-*.png` | The narrowest phone | As at 390 |
