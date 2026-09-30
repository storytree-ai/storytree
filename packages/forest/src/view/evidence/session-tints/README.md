# Session tints on coasts and claimed territories (ADR-0804 D9)

Increment `increment_11b7ea2173b2`, arc "Code islands". The orbiting wisps are gone: a running
session tints an arc of its island's coast in its own colour (fainter when the session is quiet), and
fills the territory of each capability it claims. This is a picture for the owner to judge; nothing
here is recorded as accepted (ADR-0794).

| View | Picture |
| --- | --- |
| Resting front view, all eight islands | [front.png](front.png) |
| Close-up (camera zoom x2.6) on The agent link: two coast arcs, two claimed territories | [close-up-agent-link.png](close-up-agent-link.png) |
| Close-up (x2.6) on The forest: the quiet session's faded coast and its claimed territory | [close-up-forest.png](close-up-forest.png) |
| Same three, with session ids whose hashed colours sit close together (hue 356 and 335) | [as-hashed-front.png](as-hashed-front.png), [as-hashed-close-up-agent-link.png](as-hashed-close-up-agent-link.png), [as-hashed-close-up-forest.png](as-hashed-close-up-forest.png) |

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1.
Seed: the same eight-story, 58-capability snapshot as [../territories](../territories/README.md), code
survey regenerated from this branch (`tsx survey.mjs`). The page's clock is fixed at
`2026-10-01T12:00:00Z` and the stand-in bridge's `linesSince` returns the 13-line agent log written
in `capture.mjs`, so the tints are the real page's reading of real log lines (`sessionRows`,
`sessionWisps`, `coastArcs`, `claimTints`), not injected marks. Run `node build.mjs`, then
`node capture.mjs` (and `CAPTURE_IDS=as-hashed node capture.mjs` for the close-hue set), each under
`flock /tmp/storytree-heavy.lock`. Full numbers: [measurements.json](measurements.json),
[as-hashed-measurements.json](as-hashed-measurements.json).

## The log (at the fixed now)

| Session | Last line | Holds | Judged |
| --- | --- | --- | --- |
| A (Claude Code, hue 207, blue) | 1 minute ago, turn open | Agent tools (The agent link), Library transactions (The library) | working |
| B (Claude Code, hue 301, magenta) | 30 seconds ago, turn open | Claims (The agent link) | working |
| C (Claude Code, hue 248, violet) | 45 minutes ago, turn ended | Story node render (The forest) | waiting, past the 30-minute quiet time, still inside the 1-hour leave time |

## Measured before looking

- Sessions list rows (`sessionRows`): 3, all Claude Code. A: working, stories The agent link + The
  library. B: working, The agent link. C: waiting, idle (folded under "1 idle" in the list), The forest.
- Coast-tint bands by island: The agent link 2 (A `hsl(207,80%,68%)` opacity 0.9, B `hsl(301,80%,68%)`
  opacity 0.9); The forest 1 (C `hsl(248,80%,68%)` opacity 0.35); The library 1 (A, opacity 0.9). The
  other five islands 0. Band width in plate units: 1.6 (`TINT_WIDTH` in `session-tints.ts`).
- Claimed territories (`territory:<capability>` userData.claimedBy, fill opacity 0.32): Claims ->
  B's colour, Agent tools -> A's colour (The agent link); Story node render -> C's colour (The
  forest); Library transactions -> A's colour (The library). 4 claimed territories, 0 elsewhere.
- Objects whose name or userData mention a wisp, whole scene, at rest and in both close-ups: **0**.
- No page errors; one Three.Clock deprecation warning, as before.

## What the pictures show, and what to judge

- **Legible at the resting view.** In [front.png](front.png) the three tinted islands are picked out from
  the five untinted by a thin bright rim, and The agent link's pink/blue split shows even at that
  size. Judge whether the rim is wide and strong enough to read at rest: it is a thin line beside the
  white coast line, not a mass of colour.
- **Two arcs read as two sessions** ([close-up-agent-link.png](close-up-agent-link.png)): the coast splits into a
  blue northern half (A) and a magenta southern half (B) with the sessions list's two dots in the
  same colours, so the split is unmistakable when the hues are far apart. With hues 21 degrees
  apart ([as-hashed-close-up-agent-link.png](as-hashed-close-up-agent-link.png), red 356 and pink 335) it reads as one pink
  outline, not two sessions. Hue comes from a hash of the session id, so two live sessions on one island
  can land this close; whether that is acceptable, or whether arcs need another cue (a gap between
  them, or hues spread by rank), is the owner's call.
- **Faded look** ([close-up-forest.png](close-up-forest.png)): the quiet session's coast is 0.35 against 0.9, and it
  reads as a faint violet rim, still visible against the dark sea but clearly quieter than the live
  arcs. Its claimed territory (Story node render) now fades with it, to 0.14 against a live claim's
  0.32: the first capture had it at full strength, and that was fixed before this re-capture.
- **Claimed-territory fill**: 0.32 opacity in the claimant's colour over the territory's own tint; it
  reads as a clear coloured cell (blue Agent tools, magenta Claims), and the file circles stay
  readable on top. Judge the strength; it is stronger than the rim at rest.
- **A claim on a capability with no surveyed code draws no territory.** An earlier run claimed
  Capability tree (The forest) and Work in flight (The library), which own no files in the survey; they
  have no territory cell, so only the coast tint showed. The final log claims capabilities that have
  territories. That is by design of the territories, but it means such a claim shows only as a coast arc.

## Problems seen

1. Two live sessions with near hues merge into one outline (above). Not fixed here.
2. (Fixed, re-captured.) A faded session's claimed territory kept its full fill; it now fades to 0.14.
3. The stand-in bridge has no readings, so the sessions panel says "Sessions could not be refreshed.
   Retrying..." and shows empty token bars; that is the capture bridge, not the page.
