# The arc's detail panel is tables you scan — ADR-0980 D5

The actual desktop renderer, captured unedited with headless Chromium over an isolated Postgres and an
explicit fixture (`capture.mjs`, run with `--retake` after `apps/desktop/build.mjs`). Dark theme at 2×
scale. Nothing in the owner's library or running app is opened or changed.

- [The panel closed](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/detail-panel/panel-closed.png): the intent folded, two questions (open, settled), seven open or
  failed increments with one short cell each, and "39 landed" folded.
- [An increment row open](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/detail-panel/increment-open.png): its objective, its wait by name with its reason, and the
  owner's question it waits behind. No planning body.
- [The landed fold and the intent open](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/detail-panel/landed-open.png), both kept across the two-second live redraw.
- [A settled question open](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/detail-panel/question-open.png): its answer on top of the full reading.
- [Measured results](capture.json).

The fixture's *Website* arc carries a row of each kind: "you" for a question it is held on and for an
owner note; "you" and "1 increment" for work waiting on that held work; "event"; an agent's label and
quiet minutes; "to take"; "not completed"; and 39 landed with their pull request numbers. A passed
check-back ("check-back passed") cannot be written from today, so it is proved by unit test 5.5 only.

Measured first: the intent fold starts closed; no intent, objective, answer or planning body text is in
the panel's visible text until a row opens; an opened increment row, the landed fold and the intent fold
stay open across a live redraw; an arc with no questions shows no questions section.

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 4 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/arc-surface/evidence/detail-panel).
