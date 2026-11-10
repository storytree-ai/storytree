# A capability's panel lists its open work in order (rollout 2, step 4c; ADR-1253 D1)

The real desktop page on storytree's own live library, read with the app's own reads (the capture kit's `liveAnswers`), so
the open work shown is the library's as it stood at the capture: no stand-in arcs. The capture picks the capability with the
most open increments (one with an active increment first), clicks its island, waits for that capability's settlement (each
island's roads and settlements are routed off the page, minutes in on the live library), faces the island and closes up,
then clicks the settlement's territory (the panel draws no tree to pick from, ADR-1285) and opens the **Open work** fold.

What this step shows (contracts 5.19 and 4.38): under the capability's word, its reason and its parked line, an **Open work**
list of every open increment whose capabilities list names it, by title: the active ones first (in bold, marked "in
progress"), then the rest in parked order. A capability no open increment names lists none. The order is read here, not
drawn on the map, where the dot and the arc's ring stay as step 4b drew them.

At this capture (2026-11-10, on the Mint box) the library's busiest capability with active work was The library's
"4 · Work model", named by two open increments: the active one first, marked "in progress", then the other.

Pictures, 1440 x 960:

- `capability-open-work.png`: the whole page, The library's island selected, the panel on Work model.
- `capability-open-work-panel.png`: the panel alone.

Taken with `node --import tsx packages/forest/testing/view/panel-open-work/capture.mjs --retake`, which asserts that the
panel lists exactly the increments, in the order, that the library's annotated tree gives, and writes both into
`measurements.json`.

In the evidence bucket for #489, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `489/capability-open-work.png`, `489/capability-open-work-panel.png`.
