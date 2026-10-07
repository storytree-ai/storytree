# The traversal reaches the code (ADR-0804 D5)

Increment `increment_d02249eaf5a4`, arc "Code islands". A selected session's window (agent link 9.10) now
lights the land: a file it opened lights its circle with the in-view ring, a step between two files hops
just above the surface (solid when one imports the other, dotted otherwise), a step between a file and a
knowledge note dives through the surface into the core or rises out of it, and opening a capability fills
its territory. Arcs, increments and contracts are drawn nowhere. These are pictures for the owner to
raise anything wrong from; nothing here is recorded as accepted (ADR-0794).

| View | Picture |
| --- | --- |
| No session selected: nothing of the code is lit | [0-none-selected.png](0-none-selected.png) |
| Resting front view, the session selected | [1-front-selected.png](1-front-selected.png) |
| The knowledge core island, camera zoom x2.4 | [2-knowledge-core.png](2-knowledge-core.png), closer (x6): [2b-knowledge-core-close.png](2b-knowledge-core-close.png) |
| The forest island: two files, a solid hop, and the dive and hop leaving it | [3-forest.png](3-forest.png), closer (x6): [3b-forest-close.png](3b-forest-close.png) |
| The far hop from the forest to the agent link, both islands in view | [4-hop-to-agent-link.png](4-hop-to-agent-link.png) |

Renderer: headless Chromium 148, ANGLE / Vulkan SwiftShader, 1440 x 960, dark theme, device scale 1,
reduced motion (so the replay's finished picture is what is drawn). Seed: the eight-story snapshot of
[../knowledge-under-islands](../knowledge-under-islands), the code survey of `main` in `survey.json`
(`survey.mjs`), and one running session ("Build the traversal over the code") whose window is fixed in
`capture.mjs`: it reads a compacted file, opens a capability, an arc and an increment (the last two
drawn nowhere), four more knowledge-core files, two notes, two forest files, a script no story
owns, and one agent-link file. Run `node build.mjs`, then `node --import tsx capture.mjs`, under
`node "<checkout>/packages/dev-loop/src/heavy-lock.mjs" --`. Full numbers are in [measurements.json](measurements.json).

## Measured before looking

Read from the drawn scene, radii in the globe's own units (the sea's shell is 218; the circles lie at 219.79).

- **Steps:** 9 lines for the window's 14 opens, in reading order, exactly the expected ones (the capture
  asserts them): 6 hops between files (4 solid, on a surveyed import; 2 dotted, none between them), 2 dives
  (a file to a note, a note to a file) and 1 step between two notes (dotted, as before). Per line below.
- **Hops stay above the surface:** every hop's lowest point is 219.79 (the circles' own height); its highest
  is 222.5 to 229.3 within an island and 228.3 on the forest, 246.2 (12% of the radius above the circles)
  for the far hop from the forest to the agent link. None sinks below the surface.
- **Dives go into the core:** both dives run from 219.8 down to 183.1, the notes' depth (0.84 of the radius).
- **Lit on the land:** 8 of 258 circles (5 knowledge core, 2 forest, 1 agent link), 7 with the in-view ring
  (the compacted ghosts.ts has none and is the lighter fill); 1 territory (the knowledge core's capability 4).
  Neither is dimmed by the session emphasis that dims every island but the session's own.
- **Nothing is lit without a session:** with none selected, 0 circles, 0 territories, 0 file steps. Selecting
  the row again clears them (0 lit).
- **Not drawn:** the arc, the increment and `scripts/gate.mjs` (no story owns it) leave no mark, no step and
  break no chain (9 steps, none to or from them).
- **Circle size on screen** (radius in pixels, lit circles): 2.0 to 4.9 at the resting view (zoom 1.68),
  5.4 to 14.3 at x2.4, 13.6 to 35.8 at x6. Lines are 2.4 px wide, dashes 7 units.
- No page errors; one THREE.Clock deprecation warning, as before.

| # | Step | Edge | Crosses | Lowest / highest radius |
| --- | --- | --- | --- | --- |
| 1 | ghosts.ts to look-inside.ts (ghosts.ts compacted out) | solid, faded | hop | 219.8 / 224.2 |
| 2 | look-inside.ts to surface.tsx | solid | hop | 219.8 / 225.1 |
| 3 | surface.tsx to globe-points.tsx | solid | hop | 219.8 / 222.5 |
| 4 | globe-points.tsx to reads.ts (no import) | dotted | hop | 219.8 / 229.3 |
| 5 | reads.ts to a decision note | dotted | dive | 183.1 / 219.8 |
| 6 | that note to another | dotted | notes (as before) | 183.1 / 187.7 |
| 7 | that note to planet-view.tsx | dotted | dive (rises out) | 183.1 / 219.9 |
| 8 | planet-view.tsx to file-circles.ts (imports it) | solid | hop | 219.8 / 228.3 |
| 9 | file-circles.ts (forest) to window.ts (agent link) | dotted | hop | 219.8 / 246.2 |

## What the pictures show, and what to judge

- **Meaning outranks appearance; a connector that does not connect is a defect.** Every line ends on the
  circle or note it names (the capture checks the ends by construction: a step whose end is not placed is
  not drawn). Solid means an import between the two files, dotted means none, as a stored link means solid for
  notes. The dives are dotted, since no import or link joins a file and a note; this is a judgment made here
  (the ADR does not say), reversible. Pass.
- **Legible at the resting view.** At [1-front-selected.png](1-front-selected.png) the picture reads: the
  knowledge core's land is lit as one territory, and dotted lines cross from it to the two notes and to the
  forest and agent link, with the lit circles ringed on each of the three islands, though a lit circle is
  only 2 to 5 px across (4 to 10 px with its ring) and the arcs' lift above the surface cannot be seen from
  straight above. Pass for "which islands, which capability, and which way"; concern for telling the
  individual circles apart, which needs the x2.4 view or closer. Not fixed here.
- **The lit territory is the whole island.** The knowledge core's capability 4 owns most of the island's
  land (its territory is nearly the island), so "opening a capability lights its territory" reads as lighting
  the island. That is the data's own truth (the survey's split), not a drawing defect.
- **The lit fill and the lines share a hue.** The session's colour is used for the territory fill, the
  circle fill and the lines. On the lit territory the lines read against the lighter circles but are thin
  against the fill; the fill was lowered to 0.36 opacity (the first capture's 0.55 lost them) and the lines
  widened to 2.4 px. Judge whether the hop lines across a lit territory are strong enough.
- **The session's traversal is bright on every island.** The forest and agent link islands are dimmed (the
  session emphasis) while a session is selected; the first capture found the lit circles dimmed with them or
  wiped by the emphasis's restore. Lighting is now laid over the circles as separate marks the emphasis skips,
  so the far islands' lit circles read at full strength ([3-forest.png](3-forest.png)).
- **Replay.** The finished picture is shown; each file circle lights at once, not as the replay's head
  reaches it (the notes do): with motion on, a circle is lit before its line grows.
