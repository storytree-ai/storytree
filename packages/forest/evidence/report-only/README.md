# A first user's story panel leads with the agent's report (forest 4.13, ADR-0630)

In a project whose health nothing verifies (any user's project in the MVP: no verified entry
anywhere in it), each built capability's card strip says the agent's report ("AGENT: PASSING",
"AGENT: FAILING", "AGENT: NOT CHECKED") in place of "UNTESTED". Its detail heads with "the agent
reports passing" and says "storytree does not check this project's tests yet." It has no "Why not
green" and no mover. A proposed capability still says PROPOSED. Strip colours are unchanged: a
report-only card keeps untested's neutral grey, so the agent's word never paints a card green
(ADR-0744 D3).

Seeded, repeatable captures: `node packages/forest/evidence/report-only/capture.mjs` bundles the
fixed TodoMVC-like tree in `entry.ts` (no randomness, no clock) through the real `drillDown` view
model and the real `renderStoryPanel`, with the desktop page's real `styles.css`, in headless
Chromium at fixed viewports (1280 x 800 desktop, 390 x 844 narrow). Measured values are in
`measurements.json`.

Pictures (dark unless named):

- `reported-passing.png`: "Add a todo", the agent reports passing.
- `reported-failing-light.png`: "Complete a todo", the agent reports failing, light theme.
- `nothing-reported.png`: "Survives a reload", the agent has reported nothing.
- `reported-passing-narrow.png`: "Main and footer" at 390 px, contracts unfolded.

The capture asserts every shot has exactly one sentence under the word, "storytree does not check
this project's tests yet.", and that none of "untested", "no test names", "moves this one" or "Why
not green" appear in the panel's text. The panel's scrollWidth equals its clientWidth in every shot
(478 px desktop, 364 px narrow).
