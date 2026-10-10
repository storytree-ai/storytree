# The shop's four islands: a column today, rows at their own plan's places

An investigation, not a landing: nothing on the site changed. The owner, 2026-10-10, on the map chapter: "the
current layout of the islands looks wrong, if browsing, cart and checkout are all dependant on signing-in they
should appear directly above signin as a row, or should be browsing second row, and the rest third row, if card
and checkout are also dpendant on browsing". These pictures are behind the question on the arc "The website's
journey, polished from the visitor's seat" (arc_e42da2528db8).

| | The pathways step, its four islands whole (02:46 UTC) | The finished shop, free play |
| --- | --- | --- |
| Today: every island at its place in the finished shop | [pinned-pathways-step.png](pinned-pathways-step.png) | [pinned-finished-shop.png](pinned-finished-shop.png) |
| The four at their own plan's places | [rows-pathways-step.png](rows-pathways-step.png) | [rows-finished-shop.png](rows-finished-shop.png) (the same layout; only the tilt it was left at differs) |

Island middles on the page, 1440 x 900 (`pinned.json`, `rows.json`):

| | Signing in | Browsing | Cart | Checkout |
| --- | --- | --- | --- | --- |
| Today | (949, 635) | (949, 450) | (949, 265) | (949, 132) |
| Own plan's places | (949, 711) | (949, 450) | (866, 189) | (1032, 189) |

## Why it is a column

The record (`src/shop-snapshot.json`) holds two things for every moment: the stage's own scene, laid out as the
app drew it then, and `places`, each island's row and slot in the finished eight-story shop. The globe is drawn
from `places` (`src/forest-scene.tsx`, `places={grown?.places}`; `packages/forest/src/view/planet-navigation.ts`
`planetLayout`), on purpose: website promise 3.4 and forest promise 3.28 keep every island where the full plan
puts it, so islands do not jump while a growth replays.

In the finished shop Checkout depends on Orders, so the four first stories hold rows 0, 1, 2 and 3, one each:
Signing in (row 0), Browsing (row 1), Cart (row 2), Checkout (row 3). `src/map-recording.ts` narrows the scene to
those four and keeps the eight-story places, and a row with one island is centred on the globe's front, so the
four stack in a column at 46° S, 15° S, 15° N and 46° N.

From 01:53 to 03:08 UTC the shop's plan was those four stories, and every recorded stage in that time lays them
out the same way: Signing in; Browsing above it; Cart and Checkout side by side above Browsing. That is what the
app drew then, and what the owner expects. After 03:08 the plan has eight stories and the record's own layout
changes three times as code lands (03:08 five rows, 03:19 four rows, 03:21 the finished four rows).

| Recorded moment | Signing in | Browsing | Cart | Checkout | Accounts | Orders | Admin | Reviews |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01:53 to 03:08 (four stories) | row 0 | row 1 | row 2 | row 2 | | | | |
| 03:08 (pr7-building) | 0 | 1 | 2 | 2 | 1 | 3 | 3 | 4 |
| 03:19 (pr9) | 0 | 1 | 2 | 3 | 1 | 2 | 3 | 3 |
| 03:21 on (pr8, finished) | 0 | 1 | 2 | 3 | 1 | 2 | 2 | 3 |

## How the rows pictures were made

`capture.mjs rows` ran on a build with this scratch change to `src/map-recording.ts`, not committed: the four
stories take their rows and slots from the `pr4` stage's own scene.

```ts
const rowStep = Math.min(...built.scene.islands.map(island => Math.abs(island.z)).filter(z => z > 0));
const firstRound = new Map<string, number>();
for (const island of built.scene.islands) {
  const row = Math.round(Math.abs(island.z) / rowStep);
  const slot = built.scene.islands.filter(other => Math.round(Math.abs(other.z) / rowStep) === row && other.x < island.x).length;
  firstRound.set(island.story, row * 1000 + slot + 1);
}
return { ...saved, places: saved.places.map(place => ({ ...place, place: firstRound.get(place.id) ?? place.place })), scene: narrow(checked.scene), stages };
```

Rerun: `WEBSITE_SHA=$(git rev-parse HEAD) pnpm --filter @storytree/website build`, then
`node --import tsx packages/website/evidence/island-rows/capture.mjs pinned` (or `rows` on the changed build).
