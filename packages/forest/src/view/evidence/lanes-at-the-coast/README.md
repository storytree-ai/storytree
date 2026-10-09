# Selection lanes stop at the coast

World contract 6.8 (ADR-0951 D1, increment_943855891a02). A lit lane now runs only along the road between islands,
dock to dock: from the dock of the island built on to the dock of the island building on it. It no longer branches
inland to its capabilities. A small disc in the lane's colour lies on each dock a lit lane uses, and appears when the
lane's front leaves that dock or reaches it. Where an up and a down lane share a dock, the two colours sit side by side.
The island routes are still built (forest 3.7); the lanes just stop riding them.

The owner's scene: storytree's own plan (a read-only snapshot taken 2026-10-09 by [seed.mts](seed.mts), 20 stories,
115 capabilities), desktop page in headless Chromium, 1440 x 960, dark theme, the globe turned to face The library,
The map and Keys, then The library clicked. Same seed, turn and click for both builds. **Before** is `main` at
78b4883d; **after** is this branch.

| | Before | After |
| --- | --- | --- |
| The library selected: 18 lanes (1 up, to Keys; 17 down, from The map, The command line, The agent link and The knowledge core) | [before-library-selected.png](before-library-selected.png) | [after-library-selected.png](after-library-selected.png) |
| Close-up at the library's dock of the road carrying the most lit lanes (17 down lanes share it), zoomed to just short of where the globe changes to the library's notes | [before-shared-trunk.png](before-shared-trunk.png) | [after-shared-trunk.png](after-shared-trunk.png) |

The JSON beside each picture gives every lane mesh and how far each of its ends sits from the nearest end of a road
between islands. Before, ends lay up to 103 ground units away, inland at capabilities. After, every end lies 0.12 from
a road's end, which is the lane's lift over its road. It also lists the 7 marks after (none before), all visible once
drawn. The library's own marks sit under the selected island's ring, which draws over them.

No dock in this plan is shared by an up and a down lane of The library (its only up lane goes to Keys, by a road no
down lane uses). The side-by-side pair is pinned by world 6.8's test in
`packages/forest-world/src/planet/lanes.test.ts` instead.

## Reproduce

From the repository root, under the machine's heavy-run lock:

```sh
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/lanes-at-the-coast/capture.mjs before <main checkout> --retake
node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/lanes-at-the-coast/capture.mjs after --retake
```

Each run builds the desktop page of its checkout with `buildCapture` into ignored `dist/`. Without `--retake`, the
output goes to a scratch folder. To refresh the seed, run `tsx seed.mts` in this folder. It reads the library and
writes nothing to it.
