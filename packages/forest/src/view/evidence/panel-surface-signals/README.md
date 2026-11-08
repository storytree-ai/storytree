# The panel's surface says only what needs you: a word with its source, a why line only when it matters (ADR-1284 D2, D3)

Storytree's own map (the code-rows snapshot and its survey) as the app opens it, close up on The library. A healthy capability
is picked on the island, then one that is not green, then that one's Health handle is clicked open (one click, ADR-1287).

What this shows (contracts 4.6 and 4.12): a healthy capability's surface is its title, its word and its lead, with no why
line and its two health readings behind "Health · 2"; one that is untested and moved by the owner adds one why line saying so;
the story's surface says "1 capability needs you" under its lead, because the owner moves one of its capabilities. The
snapshot records no source for storytree's own readings, so the words show alone here; "healthy, from CI" is pinned by the
panel's tests. Before: #607's `capability-picked-on-island-panel.png`, where both readings sat on the surface as badges.

Pictures, 1440 x 960:

- `healthy-capability-panel.png`: the panel after a healthy capability (Work in flight) is picked, every fold closed.
- `not-green-capability-panel.png`: the panel after Cloud connection (GCP), untested and moved by the owner, is picked.
- `health-opened-panel.png`: the same after Health is clicked open: the agent's report and storytree's, side by side.
- `healthy-capability.png`, `not-green-capability.png`, `health-opened.png`: the whole page at each step.

Taken with `node --import tsx packages/forest/testing/view/panel-surface-signals/capture.mjs --retake`, which asserts that a
healthy pick shows no why line and keeps its readings behind Health, that a not-green pick shows one why line, and that a
click opens Health, and writes what it found into `measurements.json`.

In the evidence bucket for #630, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `630/healthy-capability-panel.png`, `630/not-green-capability-panel.png`, `630/health-opened-panel.png`, `630/healthy-capability.png`, `630/not-green-capability.png`, `630/health-opened.png`.
