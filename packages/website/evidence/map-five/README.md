# The map chapter in five steps, with signing in's claims as flags

2026-10-10, Mint box, increment_56c04a002c2a: ADR-0891's second amendment of 2026-10-10 (five steps) with ADR-0968 (a claim is a flag; on an island with no code, a lot). Website 2.16. Locally built site, headless Chromium with SwiftShader.

## The five steps

| Step | 1920 | 1440 | 1280 | 390 | 320 |
| --- | --- | --- | --- | --- | --- |
| 1 · The beginning | [1920](1920-map-empty.png) | [1440](1440-map-empty.png) | [1280](1280-map-empty.png) | [390](390-map-empty.png) | [320](320-map-empty.png) |
| 2 · on its claims line | [1920](1920-map-first-line-3.png) | [1440](1440-map-first-line-3.png) | [1280](1280-map-first-line-3.png) | [390](390-map-first-line-3.png) | [320](320-map-first-line-3.png) |
| 2 · A story, its capabilities, and who is building them | [1920](1920-map-first.png) | [1440](1440-map-first.png) | [1280](1280-map-first.png) | [390](390-map-first.png) | [320](320-map-first.png) |
| 3 · Your code | [1920](1920-map-code.png) | [1440](1440-map-code.png) | [1280](1280-map-code.png) | [390](390-map-code.png) | [320](320-map-code.png) |
| 4 · Pathways | [1920](1920-map-together.png) | [1440](1440-map-together.png) | [1280](1280-map-together.png) | [390](390-map-together.png) | [320](320-map-together.png) |
| 5 · Health | [1920](1920-map-health.png) | [1440](1440-map-health.png) | [1280](1280-map-health.png) | [390](390-map-health.png) | [320](320-map-health.png) |

Each step is pictured as it settles (the second also while its claims line is told, before the sessions list opens). `framing.json` records where the names of the islands each step frames stand against the screen's edges, the header, the card, the bar and the panels: no misses. [1440-steps-1-to-3.webm](1440-steps-1-to-3.webm) plays steps 1 to 3 at 1440 at the tour's 0.75×, with the camera's line-cued move on "Look inside a story".

## The first island, as its session stakes it and its code lands

Played at 0.75× by `../recorded-claims.mjs`, which also checks every rendered frame's flags (see [its README](../recorded-claims/README.md)).

| Moment | 1440 | 390 |
| --- | --- | --- |
| Before any claim: signing in plain | [1440](1440-first-island-1-before-claim.png) | [390](390-first-island-1-before-claim.png) |
| The shop server's flag arriving in its lot (the camera easing in) | [1440](1440-first-island-2-flag-arrives.png) | [390](390-first-island-2-flag-arrives.png) |
| The flag in its second lot, the session | [1440](1440-first-island-3-second-lot.png) | [390](390-first-island-3-second-lot.png) |
| The flag in its third lot, the page shell, with its ripple | [1440](1440-first-island-4-third-lot.png) | [390](390-first-island-4-third-lot.png) |
| The sessions list open, its one row in the flag's colour | [1440](1440-first-island-5-sessions.png) | [390](390-first-island-5-sessions.png) |
| The code landing: the lots give way, two territories so far | [1440](1440-first-island-6-code-lands.png) | [390](390-first-island-6-code-lands.png) |
| All three landed territories | [1440](1440-first-island-7-code-landed.png) | [390](390-first-island-7-code-landed.png) |

On a phone the flag is drawn as the renderer's small-scale dot in the session's colour (ADR-0968's size rule), not a pennant.

## What the record supports, and what it does not

- **"It starts as one. Each time your agent builds another capability, the island splits to make room for it."** Supported where it is said: step 3 opens on the shop server's territory alone covering the island, then the session's and the page shell's split it, in the order the agent landed them. Two things the replay draws that the line does not say: in step 2 the island already shows five equal shares (the lots' ground, ADR-0968 D4), and only three of the five capabilities had code at the merge (the sign-in page's code reaches the map with the next pull request; sign-out's never does within the chapter), so step 3 ends on three territories, not five.
- **The island is drawn smaller once its code lands.** The shop's record sizes an island with no code by its plan and one with code by its lines, so signing in shrinks as step 3 begins. This was already so in the six-step chapter, inside its second step; the camera does not move.
- **The flag moves three times while the claims line is told**, from the shop server to the session, the page shell and the sign-in page, and into sign-out's lot as the last line begins. Between moves it lifts and the next drops in (01:56:24 to 01:58:24); the shop server and the session overlap for 16 seconds of record, so two flags stand briefly.
- **Pathways** shows only checkout's two flags at pr5: the cart's and checkout's agents also claimed capabilities while those islands had no code, but the shop's record gives those islands no shares to stand in, and the chapter adds no mark of its own.

## Reproduce

```sh
WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build
node packages/website/evidence/arrival/capture.mjs --only mapSteps
node --import tsx packages/website/evidence/recorded-claims.mjs
```
