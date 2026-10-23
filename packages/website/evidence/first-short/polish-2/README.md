# The first short's second polish loop (increment_fa48e88589f9)

The owner's notes on PR #1540's cut (question_325b76dba4ae, 2026-10-19), as five changes on top of the first loop's bar
(`../polish/`): the shop's map, not storytree's own; the feature asked for as a new story node whose capability graph he
inspects; no frustration on the left; 1.5 times the room (480×270 at ×4, ADR-1084); the walk-out not through the chair.

Five rounds, each: render the 1080p cut, build contact sheets (frames every 0.25 s plus the frames either side of every cut,
each labelled), a still of every beat and the script's timing table (`round.mjs`), then a fresh-context director subagent given
only `rubric.md`, those pictures, the owner's reference and the app's screenshot of the shop (never the builder's reasoning)
returns numbered findings with a timestamp and a severity and a pass or fail on each of the ten rubric items. Every blocker and
major was answered before the next round, fixed or rejected with its reason (each round's `findings.md`); the loop stops at no
blocker and no major, or after round 5. It stopped after round 5. **The director cannot see motion:** it sees sampled stills
only, so the walk cycle, the chair's roll, the cursor's path, the panel's slide and any pop between samples were never judged.

| Round | Blockers | Majors | Items failed | What the round's answers were |
| --- | --- | --- | --- | --- |
| 1 | 0 | 5 | 2, 4, 6, 7 | the whole shop sheet framed, every island named; the app's panel (title, description, its graph with the pop-out button) and the map sliding aside; the halves cutting together, 58 s; the graph's names and the yellow land rejected as the saved plan's and the app's own |
| 2 | 0 | 2 | 2, 9 | the sheet fitted beside the panel; the app's toolbar and sessions strip round the map; part numbers kept with their names; flat green islands rejected (the shop's parts are all proven) |
| 3 | 0 | 2 | 2, 3, 6, 9 | the sheet tilted one step by the app's own key, closer in; a narrower panel; names placed round islands |
| 4 | 0 | 1 | 2, 7, 9, 10 | the click flies the view to the wishlist island, as the app's selection does |
| 5 | 0 | 2 | 2 | (the last round: none) |

What stands after round 5 (`round-5/findings.md`):
- The glass sheet still does not read as a thick lit slab. The forest's own drawing at the short's size is as flat (checked on
  a still without the short's palette); its land's height is under a pixel there. After the click flies in, an empty dark strip
  shows under the land.
- The island fills two parts yellow while the graph labels them untested on grey strips. Both are the app's own vocabulary, one
  on its map and one in its graph.

The pictures are stored as 256-colour PNGs (they come from the compressed MP4 anyway); `round.mjs` writes them full-colour. The
PixelLab calls this loop made (33 generations, the room and two poses) are in `../pixellab/generations.json`.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 185 pictures, each one's last copy kept in git history at [`round-1/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/first-short/polish-2/round-1) (37), [`round-2/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/first-short/polish-2/round-2) (37), [`round-3/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/first-short/polish-2/round-3) (37), [`round-4/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/first-short/polish-2/round-4) (37), [`round-5/`](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/website/evidence/first-short/polish-2/round-5) (37).
