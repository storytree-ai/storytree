# A territory's junction is a small raised plaza, not a flat dot (ADR-1339 D2's 2026-11-16 look, contract 3.79)

Mick, by voice 2026-11-16 (voice.note_82f4daae2075): "I do like the idea of like a um, plaza or something. Nothing too um,
gimmicky. Um, just some things smaller something more 3D than a dot, I guess."

What this draws: where a territory's roads end, the junction is no longer a flat disc of the roads' sand but a small plaza
standing a low step above them: a top of the same sand, 0.7 of the foot across, on a sloped step shaded by where it faces
the light, as the plateaus' walls are (lit toward the light, darker away from it), so it reads raised from straight down
and tilted. Its foot is exactly the old disc's (1.8 times the widest road meeting there), its spot unchanged (clear of
every name and border), and it carries no icon or ornament. It is still one mesh per junction, so it adds no draw call.

storytree's own map (the code-rows snapshot and its survey), each island from its own camera stop: The library near (4
times the near detail zoom) and far (1.2 times), The agent link, The command line and The dev loop near (3 times), all
straight down (the map's opening view); and The library near and far and The agent link near tilted (Library pressed,
which eases in the tabletop tilt). Before is main; after is this branch. `close-up-*` puts one junction of The library
before (left) and after (right), enlarged five times. Counted from the scene (`*-measurements.json`): before and after, 14,
10, 11 and 5 junctions shown and no settlement symbol; each junction's height top to foot is 0 before and 0.10 to 0.20 after
(the step's 0.22 at each island's scale).

Taken by `node --import tsx packages/forest/testing/view/junction-plaza/capture.mjs before|after` (append `--retake` to
write here); before was taken with main's `island-roads.ts` in place.

In the evidence bucket for #918, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `918/after-the-agent-link-near.png`, `918/after-the-agent-link-near-tilted.png`, `918/after-the-command-line-near.png`, `918/after-the-dev-loop-near.png`, `918/after-the-library-far.png`, `918/after-the-library-far-tilted.png`, `918/after-the-library-near.png`, `918/after-the-library-near-tilted.png`, `918/before-the-agent-link-near.png`, `918/before-the-agent-link-near-tilted.png`, `918/before-the-command-line-near.png`, `918/before-the-dev-loop-near.png`, `918/before-the-library-far.png`, `918/before-the-library-far-tilted.png`, `918/before-the-library-near.png`, `918/before-the-library-near-tilted.png`, `918/close-up-the-library-near.png`, `918/close-up-the-library-near-tilted.png`, `918/review-the-agent-link-near.png`, `918/review-the-agent-link-near-tilted.png`, `918/review-the-command-line-near.png`, `918/review-the-dev-loop-near.png`, `918/review-the-library-far.png`, `918/review-the-library-far-tilted.png`, `918/review-the-library-near.png`, `918/review-the-library-near-tilted.png`, `918/before-measurements.json`, `918/after-measurements.json`.
