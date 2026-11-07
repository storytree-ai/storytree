# Sea lanes only: the beige roads between islands retired, plumbing drawn as any other lane (ADR-1261 D1, D2; ADR-1277 D1)

The real desktop page on storytree's own map (the code-rows snapshot and its survey), first at rest, then with The
library's island clicked so every lane of its capability links is lit, drawn on and settled. The story panel and the
left rail are hidden for the picture, and the selection is kept.

What this step draws (contracts 4.4, 4.8, 4.33, 3.6, 3.67): no road between islands. At rest the sea carries no line
(the capture counts 0 lanes, 0 meshes in the lanes' group and 0 road meshes). A selection lights only its lanes, each
on its own route, merged into trunks and widened smoothly up to a cap (ADR-1261 D3, D4, landed in #510). A plumbing call
(build step, cleanup, forwarder) is one more link between its two islands, drawn and lit exactly like a dependency lane,
in the one colour and with no label (ADR-1277 D1). storytree's
own map declares no plumbing call, so the plumbing pictures come from a second run on a fixture survey. In it, The
library has a build step to The command line and a cleanup to The app, so the islands are laid out a little differently
there.

Pictures, 1440 x 960:

- `at-rest.png`: storytree's own map at rest, with no line at sea.
- `the-library-selected.png`: The library selected (16 lanes lit, the longest 551 ground units).
- `plumbing-at-rest.png`: the fixture at rest, with no line at sea.
- `plumbing-the-library-selected.png`: the fixture with The library selected. Its build step to The command line and its
  cleanup to The app are lit among its lanes, in the one lane colour, with no label (the capture counts one colour and no
  label).

Taken with `node --import tsx packages/forest/testing/view/sea-lanes/capture.mjs` (append `--retake` to write here).

In the evidence bucket for #538, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `538/at-rest.png`, `538/the-library-selected.png`, `538/plumbing-at-rest.png`, `538/plumbing-the-library-selected.png`.
