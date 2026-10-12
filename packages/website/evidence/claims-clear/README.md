# The sessions list leaves the claims step's islands in view (increment_5f5a7f86246d)

Before: main at d1c8324a. After: this branch. Both from the locally built site in headless Chromium with software WebGL,
by `node evidence/arrival/capture.mjs --only mapSteps --check --widths 1920,1440,1280,390,320` (the claims step, settled and
paused) and `node evidence/journey/capture.mjs --only freeplay --check` (free play on the shop).

While the sessions list shows, the globe's drawing sits in the room the list leaves: the list's height is measured as it
renders (`--tour-sessions` on `#chapter2`) and the drawing stops above it on a laptop and in free play, and starts below it on
a phone, where the list now rises over the page's name at every phone height, as it already did on a short phone.

| Picture | Before | After |
|---|---|---|
| `1440-map-claims` | Signing in's island and name under the sessions list, bottom middle | All four islands above the list; the cart's and checkout's flags clear |
| `390-map-claims` | The list covers the cart and checkout, whose flags the step is about | The list over the page's name; all four islands and their names between it and the card |
| `320-map-claims` | As at 390 | Clear of the list, but on a globe this small checkout's name steps aside for the cart's (a known miss in the check; increment_7841aef9f70f) |
| `1440-16-freeplay-shop` | Signing in's name under the sessions tray | Every island's name above the tray |
| `390-16-freeplay-shop` | (after only) | Every island's name above the tray |

Checks: the map chapter's framing check now names all four islands for the claims step on phones too; on main it fails at
1920, 1440 and 1280 (Signing in) and at 390 and 320 (Cart, Checkout), and passes here at all five widths but for the known
320 miss. Free play's new check (every shown name clear of the tray) fails on main at 1440 (Signing in) and passes here.
