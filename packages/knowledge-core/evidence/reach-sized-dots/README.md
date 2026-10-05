# Knowledge dots sized by 90-day reach (ADR-0926)

The owner, 2026-10-05: "proceed with option 2 but make the window 90 days".

Storytree's own globe (the code-rows snapshot and its code survey, `packages/forest/src/view/evidence/code-rows`) as the desktop app opens it, at 1440 x 960. The activity log in the stand-in bridge holds 40 past sessions' reads over the last 90 days of 24 notes facing the camera (`facing.json`, listed by a `probe` run): the first read whole by every past session, reach falling off down the list, the last eight only peeked; one more note read by 40 sessions, but 120 days ago. Three sessions are running; the selected one's window opens the most-read note, a rarely read one and one nobody read. `before` is `main` at 98a4b569; `after` is this branch.

Each dot's drawn radius, from the scene, over the smallest drawn:

| | none selected: before | none selected: after | one selected: before | one selected: after |
|---|---|---|---|---|
| distinct dot sizes (431 dots) | 1 | 16 | 2 | 16 |
| most-read note | 1 | 2 (the ceiling) | 1.5 (lit) | 2 |
| rarely read note | 1 | 1.14 | 1.5 (lit) | 1.14 |
| peeked-only note | 1 | 1.04 | 1 | 1.04 |
| read only 120 days ago | 1 | 1 | 1 | 1 |
| opened note nobody read | 1 | 1 | 1.5 (lit) | 1 |

So after: size follows reach and nothing else, and selecting a session changes no dot's size (its reads show in colour and rings).

- [Before, none selected](before-none-selected.png), [after](after-none-selected.png)
- [Before, one selected](before-one-selected.png), [after](after-one-selected.png)
- Zoomed in by mouse wheel on the most-read notes: [before, none selected](before-none-selected-near.png), [after](after-none-selected-near.png), [before, one selected](before-one-selected-near.png), [after](after-one-selected-near.png)
- Enlarged three times, before beside after: [none selected](crop-none-selected-near.png), [one selected](crop-one-selected-near.png). In the second, the lit note nobody read (pink, ringed) shrinks back to the floor, and read dots around it grow.
- [What each run read from the scene](measurements-before.json), [and after](measurements-after.json)

At the globe's resting view a floor dot is about two pixels across and the ceiling about four, so the difference reads best zoomed in.

```sh
node --import tsx packages/knowledge-core/evidence/reach-sized-dots/build.mjs <main checkout> before
node --import tsx packages/knowledge-core/evidence/reach-sized-dots/build.mjs . after
node --import tsx packages/knowledge-core/evidence/reach-sized-dots/capture.mjs before --retake
node --import tsx packages/knowledge-core/evidence/reach-sized-dots/capture.mjs after --retake
```

The crops were cut from the `-near` pictures (box 500,240 to 900,440, nearest-neighbour x3) with Pillow.
