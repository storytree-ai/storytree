# A selected story's panel shows a minimal risk bar

Increment "The story detail panel shows a minimal risk bar" (increment_78c9790e518b), arc "Stability and testing
rigour, sized to storytree: research first". The owner, answering question_1740edf77e9e: "you select a story, you see
the detail panel, and you have a little risk bar on there with just some basic metrics. It should be very
minimalistic at this stage. Don't put any graphs." Three lines under the story's sentences:

- **Risk rating**, out of ten: 2 x blast depth + blast radius, from the story's risk reading (ADR-1144).
- **Users potentially impacted**: the users counted for its audience once a count is measured; until then the
  audience itself (the invited users, the public, or you alone), marked "not counted yet".
- **Extra checks**: the checks only this story carries (its guardrails, and each capability's, named with it), each
  with what sets it off: every change, or each formal release. Standard unit and integration tests are not listed.

A story with no reading and no extra checks shows no bar. This is a picture for the owner to judge; nothing here is
recorded as accepted (ADR-0794). The unit tests (contract 4.36 in `drill-down.test.ts` and `story-panel.test.ts`)
hold the behaviour.

The capture (`capture.mjs`) draws the actual desktop page from storytree's eight-story snapshot
(../knowledge-under-islands), with the readings `storytree quality story-risks` wrote on 2026-10-24 for the Desktop
app (depth 3, radius 2) and the library (depth 3, radius 4). The app is given the two extra checks the owner named
as examples; no live story carries guardrails yet.

| View | Picture |
| --- | --- |
| The app clicked: 8 of 10, the invited users, a real-app run on every change and a fresh-install sweep on its Updates capability before each formal release | [the-app.png](the-app.png) |
| The library clicked: 10 of 10, the invited users (inherited from the desktop app), no extra checks | [the-library.png](the-library.png) |
