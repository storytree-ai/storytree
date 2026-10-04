# Conduit leaves the tour (increment_0aec8e57dfa4)

No tour step had taught on Conduit since the map chapter (PR 626) and the agents chapter (PR 628) moved onto the shop
(ADR-0890, ADR-0891, ADR-0893). This increment removes its path from the tour.

What went:
- The tour's `conduit` globe (`tour.ts`): its `stage` and `lineStages`, and `globeOf`'s Conduit branch.
- In `forest-scene.tsx`: the Conduit globe, its stages, places, overview and drift order; the camera's wait-for-an-island-to-grow, which only Conduit's stages used; and the drawing's `data-stage`.
- The Conduit line in the tour's note (`tour-ui.ts`) and its recording date (`tour-counts.ts`, `build.ts`).
- `src/conduit-snapshot.json`, from the source and so from the bundle.
- Conduit's refresh command (`refresh-growth.ts`) and its test: nothing reads what it saved.
- Contract 2.9 (a tour step on Conduit's saved globe grows a stage at a time). Its test is gone, and the contract is retired with that reason. Show everything returning to storytree's globe is still checked by 2.11 and 2.12.

What stayed: the general growth refresher (`conduit-growth.ts`, renamed `saved-growth.ts`). Storytree's own growth
(`refresh-own.ts`) and the shop's (`refresh-shop.ts`) are saved through it. Its 3.4 tests still pin it: a stage holds
only what was recorded by its time, scrubbed. Contract 3.4 is reworded from Conduit's saved growth to any saved growth.

The bundle (`pnpm --filter @storytree/website build`, local):

| | Before | After |
|---|---|---|
| `forest-scene-*.js` | 7,556,685 B (gzip 1,419,923) | 7,469,494 B (gzip 1,416,127) |
| `dist/` total | 8,546,344 B | 8,458,831 B |

The tour looks the same, because no step showed Conduit. The browser journeys pass on the built site.
