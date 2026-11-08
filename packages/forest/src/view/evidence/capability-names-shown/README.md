# Every territory on an island shows its name: overlapping capability names move apart, none fades (3.33, increment_3942ebdf3e7c)

Found in the fifth guided run on the checkbox repository (increment_9556d994e193): with five territories on its island, the
"Database connection" name sat over "Caller lookup"'s and faded to nothing, so the island read four names for five territories.
On main, where two capability names overlap on screen the smaller territory's fades (ADR-0917 D3). After this change none
fades: taken from the larger territory's down, a name that clears the names already placed stays on its point, and one that
does not takes the shortest move, beside a name in its way, that clears them all (`spreadCapabilities` in `nameplates.ts`).
Story names are untouched: an overlapping one still fades and none moves (ADR-0917 D2).

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, at 1440 x 960. The capture faces each of the 15
islands in turn, just past the zoom the capability names show from (3.86, 2.3 CSS pixels per ground unit), where they stand
closest, and counts the capability names drawn inside the window, those faded to nothing, and the pairs whose boxes overlap
past the 4 px slack.

| | names drawn (15 views) | hidden | overlapping |
| --- | --- | --- | --- |
| before (origin/main) | 431 | 124 | 2 |
| after | 433 | 0 | 0 |

Facing The library, before: 12 of 37 names in the window hidden, among them Cloud connection (GCP), Knowledge entrances,
Ranked search and Postgres binaries; after: 0 of 37, none overlapping.

Pictures, 1440 x 960:

- `before-the-library-near.png`: The library on main, near: Knowledge entrances, Cloud connection (GCP), Ranked search,
  Postgres binaries and The world's Props and dressing, The canvas and Hit targets are missing.
- `the-library-near.png`: the same view after: every name shows, the crowded ones a few pixels apart.

Taken with `node --import tsx packages/forest/testing/view/capability-names-shown/capture.mjs --retake`, which asserts that,
facing each island, every capability name drawn shows and no two overlap, and writes what it found into `measurements.json`;
the before is the same run on origin/main's `nameplates.ts`, `island-overlays.tsx` and `styles.css`, its assertion set aside.

In the evidence bucket for #617, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `617/before-the-library-near.png`, `617/the-library-near.png`, `617/measurements.json`, `617/before-measurements.json`.
