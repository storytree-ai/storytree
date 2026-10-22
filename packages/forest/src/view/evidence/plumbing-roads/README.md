# The map draws plumbing calls between stories, labelled by kind

Increment `increment_d86114a308d9` (ADR-1085 D3, ADR-1078 rule 5): forest-world 4.29 to 4.34, forest 3.67 and 3.68.
These are pictures for the owner to look at. Nothing here is recorded as accepted (ADR-0794).

A plumbing call is a build step or a cleanup the checkout's `storytree.check.json` declares, or a forwarder the survey
detects from its structure. It is not counted when a package is placed, but the planet draws it as a road between the
two islands it joins, labelled with its kind's words only: **build step**, **cleanup**, **forwarder**. No value word
(smell, warning, bad) appears anywhere; the files behind a kind are the label's hover title.

| View | Picture |
| --- | --- |
| Storytree's own map as it opens: Setup's build step to Plugin loader runs the whole sheet, the label at its middle; Setup's cleanup to Code review is labelled beside Map view | [opening.png](opening.png) |
| Panned east so Setup, Desktop app, Code review and the cleanup road are on screen | [setup-east.png](setup-east.png) |
| Wheeled in on Setup and Code review | [setup-close.png](setup-close.png) |
| A rehearsal, not storytree's own map: the two plumbing edges lose their capability ends (as most plumbing has none), so no dependency road is drawn for them. The cleanup road's last stretch to Code review is a road only plumbing uses | [plumbing-alone-close.png](plumbing-alone-close.png) |

## How a plumbing road looks, and the principles it is judged by

- **A road only plumbing uses** is its own ink, a muted grey-green (`#8fa9a4`, halo `#a9c4bf`), and 0.6 ground units wide,
  against 1.5 for a road one dependency uses and sand `#c7bba1` for dependencies. In the rehearsal it reads as a hairline
  beside the sand roads. Plumbing is never counted into a road's width.
- **A road a dependency shares** keeps the dependency's sand and lays a thin thread of the plumbing ink down its middle
  (40% of the road's width). Roads between islands merge into trunks, so a plumbing road mostly rides shared roads: on a
  trunk the thread reads (the build step, all along its run in `opening.png`); on a thin one-link branch it is about a pixel.
- **The label** is a small outlined chip in the plumbing ink at the road's middle, a DOM element (so it stays text and
  reads to a screen reader), under the islands' names so it never covers one.

Principles cited:

- *One element per signal.* One road and one chip per (pair, kind); no composite reading, and a pair with two kinds
  stacks two chips on the one road. Met: 2 plumbing calls draw 2 chips (`labels` in each `*.json`), and `plumbing` in
  the road group's userData lists exactly 2 entries.
- *Meaning outranks appearance.* The only word on a road is what it is. Met: chips read `build step` and `cleanup`
  and nothing else; a unit test (4.31) renders the chips and fails on any other text.
- *Legible at the resting view.* Both chips are inside the canvas at the opening view and readable at 11 px. Concern:
  the cleanup chip's box meets the Map view name plate's box (1 name in `opening.json`, `setup-east.json`; none at
  `setup-close`), because the middle of that road falls beside Map view. The name stays on top (z-order) and its text
  is whole; the chip is partly behind the plate's dark pill. And at `setup-close` the build step's chip is off screen
  (it is at the middle of a road 1,000 px long): the plumbing road is then labelled only where its middle is.
- *A connector that does not connect is a defect.* Each plumbing road starts on a dock of its `from` island and ends on
  a dock of its `to` island (test 4.29, dock to dock), as a dependency road does; a call naming a story with no island
  is left out without costing another road.

## Measures (from the `*.json` files)

- 24 stories; storytree's own survey marks **2** plumbing calls: 1 build step (`src/bins/build.ts`, Setup to Plugin
  loader) and 1 cleanup (`src/project/index.ts`, Setup to Code review); **0** forwarders (none left on main).
- Roads between islands: **417** capability links, **18** road segments ride a plumbing road, 18 threads laid on them
  (all of them shared roads). In the rehearsal 17 threads and **1** plumbing-only segment, 0.6 units wide.
- The build step (Setup to Plugin loader) is one road about a sheet wide: Setup stands at the sheet's east edge and
  Plugin loader at its west. Its label sits at the middle, over the long trunk, far from both islands.

## Not decided here

Storytree's own two plumbing edges are also capability edges (the survey gives each a capability at both ends), so each
was and still is drawn as a dependency road, with the plumbing road over the same route. Whether a survey edge whose
every file is plumbing should still draw as a dependency road is not settled by this picture: forest 3.67's test asserts
that a forwarder edge with capability ends stays a road.

## Rerun

Renderer: headless Chromium, ANGLE / SwiftShader, 1440 x 960, dark theme, device scale 1.

- **Seed** (`seed.json.gz`): a read-only snapshot of the real library (project `storytree`, 24 stories), by `seed.mts`.
- **Survey** (`survey.json`): `readCodeSurvey` over this branch with the seed's tree, by `survey.mjs`; it carries the
  plumbing marks the map's code survey reads from `storytree.check.json`.
- Pans are real pointer drags, the zoom real wheel notches, as in the glass-sheet captures.

From the repository root: `node --import tsx packages/forest/src/view/evidence/plumbing-roads/build.mjs`, then
`node packages/dev-loop/src/heavy-lock.mjs -- node --import tsx packages/forest/src/view/evidence/plumbing-roads/capture.mjs --retake`.
