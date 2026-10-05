# Session claims: claimed territories outlined, nothing else (ADR-0923)

Increment `increment_799b9eeea616`, arc "Claims: the world shows what is locked, and writing a part
claims it". A running session outlines the territory of each capability it claims, in its own colour
(fainter when it is quiet), and that is the only claim mark: no coast tint (ADR-0804 D9's, removed by
ADR-0923 D1), and an increment claim draws nothing (D2). The outline is 1.2 ground units deep, up from
0.3, because it now has to read at the resting view on its own. This is a picture for the owner to
judge; nothing here is recorded as accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Resting front view, all eight islands | [front.png](front.png) |
| Close-up (camera zoom x2.6) on The agent link: two claimed territories, two sessions | [close-up-agent-link.png](close-up-agent-link.png) |
| Close-up (x2.6) on The forest: the quiet session's faded outline | [close-up-forest.png](close-up-forest.png) |
| Same three, with session ids whose hashed colours sit close together (hue 356 and 335) | [as-hashed-front.png](as-hashed-front.png), [as-hashed-close-up-agent-link.png](as-hashed-close-up-agent-link.png), [as-hashed-close-up-forest.png](as-hashed-close-up-forest.png) |

The coast-tint look these replace (2026-10-01, increment `increment_11b7ea2173b2`) is in this folder's
history at commit `a96587d1`.

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1.
Seed: the same eight-story, 58-capability snapshot as [../territories](../territories/README.md), with
`survey.json` as committed (`tsx survey.mjs`). The page's clock is fixed at `2026-10-01T12:00:00Z` and
the stand-in bridge's `linesSince` returns the 13-line agent log written in `capture.mjs`, so the
outlines are the real page's reading of real log lines (`sessionRows`, `sessionWisps`, `claimTints`),
not injected marks. Run `node build.mjs`, then `node --import tsx capture.mjs --retake` (and
`CAPTURE_IDS=as-hashed node --import tsx capture.mjs --retake` for the close-hue set). The capture
asserts that no island carries a coast tint. Full numbers: [measurements.json](measurements.json),
[as-hashed-measurements.json](as-hashed-measurements.json).

## The log (at the fixed now)

| Session | Last line | Holds | Judged |
| --- | --- | --- | --- |
| A (Claude Code, hue 207, blue) | 1 minute ago, turn open | Agent tools (The agent link), Library transactions (The library) | working |
| B (Claude Code, hue 301, magenta) | 30 seconds ago, turn open | Claims (The agent link) | working |
| C (Claude Code, hue 248, violet) | 45 minutes ago, turn ended | Story node render (The forest) | waiting, past the 30-minute quiet time, still inside the 1-hour leave time |

## Measured before looking

- Sessions list rows (`sessionRows`): 3, all Claude Code. A: working, stories The agent link + The
  library. B: working, The agent link. C: waiting, idle (folded under "1 idle"), The forest.
- Coast-tint bands, whole scene, at rest and in both close-ups: **0**. Objects mentioning a wisp: **0**.
- Claimed territories (`territory-claim:<capability>` outlines): Claims -> B's colour, Agent tools ->
  A's colour (The agent link); Story node render -> C's colour, faded (The forest); Library
  transactions -> A's colour (The library). 4 outlines, none elsewhere.
- No page errors; one Three.Clock deprecation warning, as before.

## What the pictures show, and what to judge

- **Legible at the resting view.** In [front.png](front.png) The agent link's two claimed territories show
  as a magenta and a blue outline on the island, and the rest of the island is plainly unclaimed. Judge
  whether 1.2 is wide enough at rest, or too heavy close up.
- **Two sessions, two parts** ([close-up-agent-link.png](close-up-agent-link.png)): each outline follows exactly the
  territory its session claimed; where the two meet, both run side by side along the shared border.
- **Faded look** ([close-up-forest.png](close-up-forest.png)): the quiet session's outline is at 0.6 opacity against 0.95.
- **A claim on a capability with no surveyed code draws nothing.** Such a capability has no territory,
  and with the coast tint gone there is no other mark; the session's row still lists it.

## Problems seen

1. Two live sessions with near hues (as-hashed set, 356 and 335) read as one colour; their two outlines
   still mark two separate claimed parts. Not fixed here, as before.
2. The stand-in bridge has no readings, so the sessions panel shows empty token bars; that is the
   capture bridge, not the page.
