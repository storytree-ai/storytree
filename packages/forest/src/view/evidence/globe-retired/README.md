# The globe retired (increment_093d5b3b28d8)

Every host already drew the glass sheet (ADR-1043), so the code only the globe reached is deleted, as ADR-0920 deleted the
flat canvas: the orthographic globe camera and its framing (`applyPlanetFraming`), the sea shell (`createPlanetSurface`),
its name occluder (`globeOccluder`), the sea switch, the mini globe and its Home key, the sphere layout (`growPlanet`,
`planetLayout`, latitude rows), the globe drag and tilt stop (`dragTurn`, `TILT_LIMIT`), the rim markers and opening turn
(`hiddenMarkers`, `edgeMarkers`, `openingTurn`), zooming past the islands (`pastIslands`), `PlanetView`'s `sheet` switch,
and the website tour camera's drift. The website lays its recorded growth and saved snapshots on the sheet (`sheetLayout`)
where it laid them on the sphere.

Nothing visible changed. The same four views, before (main at 40cde6b9) and after, are identical pixel for pixel:

| View | Before | After |
|---|---|---|
| The app's forest page, Stories, 1440×960 | [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/before-app-stories.png) | [after](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/after-app-stories.png) |
| The app's forest page, Library, 1440×960 | [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/before-app-library.png) | [after](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/after-app-library.png) |
| The website's free play, 1440×900 | [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/before-website-1440.png) | [after](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/after-website-1440.png) |
| The website's free play, 390×844 | [before](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/before-website-390.png) | [after](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired/after-website-390.png) |

Sizes ([before](before-sizes.txt), [after](after-sizes.txt)):

| Measure | Before | After | Change |
|---|---|---|---|
| Website JS, all chunks | 9,017,348 bytes | 9,004,866 bytes | −12,482 |
| Website forest-scene chunk | 8,230,984 bytes | 8,218,509 bytes | −12,475 |
| Desktop renderer.js | 5,073,508 bytes | 5,050,548 bytes | −22,960 |
| packages/forest src lines, without tests | 6,975 | 6,554 | −421 |
| packages/forest-world src lines, without tests | 6,773 | 6,651 | −122 |
| both, with tests | 23,803 | 22,733 | −1,070 |
| packages/website src lines, with tests | 7,183 | 7,135 | −48 |

The app pictures are drawn by the actual desktop page from the read-only snapshot glass-sheet-tilt/ used (`capture.mjs`);
the website's by the built site skipped to free play (`capture-website.mjs`). Both scripts say how to run them.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 8 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/forest/src/view/evidence/globe-retired).
