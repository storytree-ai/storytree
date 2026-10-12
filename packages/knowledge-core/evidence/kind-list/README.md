# The kind list under the Library switch (knowledge core 5)

The owner, 2026-10-12: "when i click around randomly I notice i mostly click on friction items", then, offered four
placements and three recommendations, "A, proceed with your recommendations, lets see what this looks like".

Storytree's own globe (the code-rows snapshot) as the desktop app opens it, at 1440 x 960, with the Library switched
on. `before` is `main` at f6fc79b7; `after` is this branch. Counted from the scene and the page in each view:

| | dots drawn | dot colours | list |
|---|---|---|---|
| before, Library on | 431 | 1 | none |
| after, Library on | 292 | 7 | nine rows; Re-steers (25) and Friction (114) open switched off |
| after, every kind on | 431 | 9 | nine rows, all on |
| after, decisions alone | 194 | 1 | only Decisions on |

- Library on, over the islands: [before](before-library-on.png), [after](after-library-on.png)
- The Library alone (Stories off): [before](before-library-alone.png), [after](after-library-alone.png)
- [Every kind on](after-every-kind.png): the friction reports and re-steers fill the loose ball in the middle
- [Decisions alone](after-decisions-alone.png)
- What each view read: [before](measurements-before.json), [after](measurements-after.json)

A dot keeps the unlit opacity it had (0.52), so a kind's colour reads muted on the glass; the list's swatches are the
same colours at full strength.

```sh
node --import tsx packages/knowledge-core/evidence/kind-list/build.mjs <main checkout> before
node --import tsx packages/knowledge-core/evidence/kind-list/build.mjs . after
node --import tsx packages/knowledge-core/evidence/kind-list/capture.mjs before --retake
node --import tsx packages/knowledge-core/evidence/kind-list/capture.mjs after --retake
```
