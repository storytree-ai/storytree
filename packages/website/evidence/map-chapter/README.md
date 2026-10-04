# Act 2's map chapter, on the shop's three islands (increment_ec6aa6a5a70a, ADR-0891)

The map chapter now teaches on the rebuilt shop: Browsing, The cart and Checkout lit, the rest dimmed. It replaces the
Conduit `stories-*` and `capabilities-*` steps and the `scale-*` steps on storytree's globe. Locally built site,
Chromium headless with SwiftShader.

| Step (the owner's) | On screen | Pictures |
|---|---|---|
| 1. Story nodes | the whole shop, three islands ringed; "a story: The cart" | `1440-map-stories.png`, `390-map-stories.png` |
| 2. Stories split into parts | the cart's two parts, "a part: Cart page" | `1440-map-parts.png`, `390-map-parts.png` |
| 3. Your code as dots | Checkout's files as dots in its parts | `1440-map-code.png`, `390-map-code.png` |
| 4. Parts have colours | CI-verified green on Browsing, the cart and Checkout; hatched code no test reaches | `1440-map-health.png`, `390-map-health.png` |
| 5. Stories are added | the shop's second round of work replayed: Orders rises with its roads into checkout, the cart and the products | `1440-map-grow-0..2.png` (0.9 s, 6 s, 15 s in), `390-map-grow-2.png` |
| Drill-down | How it works, Why it exists, and the comparison (VS Code, Aider), no decision numbers | `1440-map-grow-depth.png`, `390-map-grow-depth.png`, `390-map-depth.png` |

**Copy:** lines quoted from the owner are his ("Storytree breaks up your codebase into stories.", "Stories are split into
parts.", "Your code is shown as dots in the parts.", "Parts have colours.", "As your project grows, more stories are
added."). Every other line, title, How and Why is **DRAFT**, marked in `tour-copy.ts`. "Each story is built as a micro
service" became "its own self-contained part", to stay true to one codebase with one package per story (ADR-0649).

**What the colours show, honestly:** on the shop, a part no test has run has no land, so no yellow appears. The step
names green, and the How names Browsing's hatched ground, which is code no part's tests reach.

See / feel / think:
- **Stories:** a small globe, three islands ringed and the rest in shadow. "Oh, features as places."
- **Parts, dots, colours:** each step adds one layer to the same three islands. Not much changes on screen, so each
  layer is easy to read.
- **Growth:** the globe drops back to its first four stories, then Orders rises and its roads run into the three.
  "That's how a project gets bigger without becoming a tangle."

Checks: `tour.test.ts` 2.16 red, then green. Browser journeys `--verify-tour` (the map chapter's depth has How and Why,
no ADR numbers, and the comparison on its last step), `--verify-camera` (the shop grows from its first stories to eight
during the growth step), `--verify-immersive`, `--verify-forest`, `--verify-recording`, `--verify-opening`,
`--verify-opening-frames` and `--verify-enlarged`, and `arrival/capture.mjs` (`--only map` makes these pictures), all pass.
