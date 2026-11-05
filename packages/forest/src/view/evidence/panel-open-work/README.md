# A capability's panel lists its open work in order (rollout 2, step 4c; ADR-1253 D1)

The real desktop page on storytree's own live library, read with the app's own reads (the capture kit's `liveAnswers`), so
the open work shown is the library's as it stood at the capture: no stand-in arcs. The capture picks the capability with the
most open increments (one with an active increment first), clicks its island, then its card in the story panel.

What this step shows (contracts 5.19 and 4.38): under the capability's word, its reason and its parked line, an **Open work**
list of every open increment whose capabilities list names it, by title: the active ones first (in bold, marked "in
progress"), then the rest in parked order. A capability no open increment names lists none. The order is read here, not
drawn on the map, where the dot and the arc's ring stay as step 4b drew them.

At this capture the library's busiest capability was Setup's "5 · Send feedback", named by two parked increments of the
identity arc, listed in parked order; no capability with two or more open increments had an active one, so the active mark
is pinned by 4.38's test, not shown here.

Pictures, 1440 x 960:

- `capability-open-work.png`: the whole page, the Setup island selected, the panel on Send feedback.
- `capability-open-work-panel.png`: the panel alone.

Taken with `node --import tsx packages/forest/testing/view/panel-open-work/capture.mjs --retake`, which asserts that the
panel lists exactly the increments, in the order, that the library's annotated tree gives, and writes both into
`measurements.json`.
