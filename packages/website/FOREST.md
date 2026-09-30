# The saved forest

From the checkout root, refresh the public drawing snapshot with:

```sh
node --import tsx packages/website/src/refresh-forest.ts
```

The command reads the `storytree` library through the public library and agent-link
functions, then uses the forest story's public `forestScene`, `storyNodes` and
`placeOnPackedGlobe` functions. It writes `src/forest-snapshot.json` only after all
reads and drawing preparation succeed. A failed refresh keeps the old file.

The committed file contains the capture time, story names and islands, capability
forms derived from agent-reported health and work state, dependency links, and
permanent globe positions. It contains no raw records, descriptions, activity
lines, session identities, credentials or source paths. Library, history and
activity are read separately; this is a saved drawing, not an atomic database
backup. Retired stories retain their places through the creation history.

`forest-data.ts` is a type-only description a browser can consume without importing
the refresh command or any database code. The snapshot test exercises the export
with private fields present in its input and verifies preservation on failure.

The lazy renderer and its same-scene still are separate work in the forest
increment. When integrating or refreshing them, capture the still and the site/app
comparison from this exact JSON, including a 390 px phone view. The current saved
scene uses the shared renderer's base islands and pathways; it does not include a
source-code survey or the desktop's territory colouring and file-circle overlays.
Do not present the saved health as independently verified health.
