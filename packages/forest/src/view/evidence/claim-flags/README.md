# Claim flags (ADR-0968)

The globe's claim mark is a flag in the holding session's colour, standing in the claimed capability's territory. It replaces the
inset border band. On an island with no code yet, a claimed share is marked as a lot (a dashed white line inside its border).

`capture.mjs` builds a page (`build.mjs`, `entry.tsx`) that mounts the real `PlanetView` on the code-rows reading, with one
island's survey left out so that island has no code. The claims are labelled fixtures:
- three sessions on neighbouring capabilities of the surveyed island, in three colours;
- one session staking two lots on the bare island;
- a fifth session whose claim arrives, goes quiet and is released.

The globe's clock is held at set moments, so each picture of a claim's life is taken at a known time.

Pictures, each at the tour's close-up (an island about 480 px wide), the resting globe (about 90 px) and a 390-wide phone (30 px at rest, so dots; 200 px close):
- `*-held.png`: three sessions' flags standing;
- `*-arrive-100_12.png`, `*-arrive-100_4.png`, `*-arrive-100_75.png`, `*-arrive-102.png`: the fifth claim dropping in, overshooting, its ring opening at the foot, then standing;
- `*-quieting.png`, `*-quiet.png`: furling and greying;
- `*-leaving.png`, `*-gone.png`: lifting away, then gone;
- `desktop-lots.png`, `phone-lots.png`: the island with no code, its two claimed shares marked as lots.

`measurements.json` records, for each view, every flag's `userData`, whether it is drawn as a dot, its pole's height on screen in px, its lot's dash count, and that no band mesh exists.

Run: `node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" -- node --import tsx capture.mjs`.
