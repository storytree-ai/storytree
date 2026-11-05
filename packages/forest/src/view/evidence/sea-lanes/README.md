# Sea lanes routed on their own: merged trunks, smooth capped width (ADR-1261 D3-D4)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), with The library's island clicked
so every lane of its capability links is lit, drawn on and settled; the story panel and the left rail are hidden for
the picture, the selection kept.

What this step draws (contracts 4.8, 4.41, 4.42): every lit lane follows its own route, laid by the trail router over
the same islands as the roads but for capability links only and kept a berth and half the widest lane off every coast,
so a lane goes around an island between its two and lanes heading the same way merge into one trunk. A lane's width
rises with the square root of the lit links sharing a stretch, from 0.32 ground units for one to a cap of 1.15 at 64,
in place of the four steps (1, 2-7, 8-31, 32 or more). The beige roads are still drawn (their retirement is the next
increment), and the roads carrying the lit links still give way while they are lit.

Not here: the owner's mocks of the merged-trunk view were shown in conversation and not kept in the library, so the
picture beside this branch's is the same view on `main`, where the lanes ride the roads.

Pictures, 1440 x 960:

- `the-library-selected.png`: this branch, The library selected (16 lanes lit, the longest 551 ground units).
- `the-library-selected-on-main.png`: `main` before this branch, the same view (16 lanes, the longest 537).

Taken with `node --import tsx packages/forest/testing/view/sea-lanes/capture.mjs` (append `--retake` to write here).

In the evidence bucket for #510, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `510/the-library-selected.png`, `510/the-library-selected-on-main.png`.
