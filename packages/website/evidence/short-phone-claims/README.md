# On a short phone, the claims step shows every island's name (increment_7841aef9f70f)

Before: main at e11e5ffc. After: this branch. Both from the locally built site in headless Chromium with software WebGL, by
`node evidence/arrival/capture.mjs --only mapSteps --check --widths 1920,1440,1280,390,320` (the claims step, settled and paused).

On a 320×700 phone the cart's and checkout's islands sit side by side, 36px apart on a 187px drawing, and their names are
too wide for that: checkout's faded as crowded. Two changes give them room. Under the sessions list on a short phone, the
globe's empty upper rim tucks under the list's lower edge (the drawing grows to 235px, its compass moved down with it), and a
story's name plate on a phone has slimmer sides (0.25rem, was 0.4rem). The names now stand about 44px apart, their letters
clear of each other.

| Picture | Before | After |
|---|---|---|
| `320-map-claims` | Checkout's name missing beside the cart's | Signing in, Browsing, Cart and Checkout named, clear of the list and the card; the compass below the list |
| `390-map-claims` | (after only) | Unchanged in framing; slimmer name plates |

Check: the map chapter's framing check no longer carries `320 map-claims Checkout: not drawn` as a known miss; it fails on
main at 320 on that miss and passes here at all five widths.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 3 pictures, each one's last copy kept in git history at [`after/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/short-phone-claims/after) (2), [`before/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/short-phone-claims/before) (1).
