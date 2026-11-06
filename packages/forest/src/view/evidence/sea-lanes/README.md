# Sea lanes only: the beige roads between islands retired, plumbing a grey-green lane (ADR-1261 D1, D2, D5)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), first at rest, then with The
library's island clicked so every lane of its capability links is lit, drawn on and settled. The story panel and the
left rail are hidden for the picture, and the selection is kept.

What this step draws (contracts 4.4, 4.8, 4.29 to 4.33, 3.6): no road between islands. At rest the sea carries no line
(the capture counts 0 lanes, 0 meshes in the lanes' group and 0 road meshes). A selection lights only its lanes, each
on its own route, merged into trunks and widened smoothly up to a cap (ADR-1261 D3, D4, landed in #510). Plumbing calls
are lanes in their own grey-green (#8fa9a4), lit with their labels while either of their stories is selected. storytree's
own map declares no plumbing call, so the plumbing pictures come from a second run on a fixture survey. In it, The
library has a build step to The command line and a cleanup to The app, so the islands are laid out a little differently
there.

Pictures, 1440 x 960:

- `at-rest.png`: storytree's own map at rest, with no line at sea.
- `the-library-selected.png`: The library selected (16 lanes lit, the longest 551 ground units).
- `plumbing-at-rest.png`: the fixture at rest, with no plumbing lane and no label.
- `plumbing-the-library-selected.png`: the fixture with The library selected. Two grey-green lanes are lit, labelled
  `build step` and `cleanup`.

Taken with `node --import tsx packages/forest/testing/view/sea-lanes/capture.mjs` (append `--retake` to write here).

In the evidence bucket for #538, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `538/at-rest.png`, `538/the-library-selected.png`, `538/plumbing-at-rest.png`, `538/plumbing-the-library-selected.png`.
