# The map chapter's stories and capabilities steps say one line each (increment_796f905c9276)

The owner, 2026-10-11, after looking at the published map chapter: fewer sentences to read, and the map itself, with labels on
it, does the telling. Each step now says one line in his words; what the dropped lines said arrives as labels on the map, timed
to its animation.

| Step | Its one line | Then, as moments within the line |
|---|---|---|
| Stories and pathways. | "In storytree, projects are made from stories. As your agents build, stories show up on the map as islands." ★ | 2 s: signing in rises, "a story" · 4.5 s: browsing rises, "a story" · 7 s: the cart and checkout rise, "a story" on each · 9.5 s: the pathways to signing in draw on, one labelled "a pathway: the cart needs signing in" (then those to browsing) |
| Capabilities and your code. | "Each story shows the parts that make it work." ★ | 0 s: territories arrive, the first labelled "a capability" · 4.5 s: file dots, the largest labelled "each dot is a file: server.js · 110 lines" · 7.5 s: signing in's panel opens, its diagram outlined and named "how its capabilities work together" |

★ the owner's words, punctuation tidied. Times are seconds at 1× (the tour plays at 0.75× by default). Titles, How and Why are
DRAFT (`src/tour-copy.ts`): each How now says in words what the dropped lines said (the order the islands rose, which story needs
which, capabilities holding files, the panel), for a visitor whose screen hides the labels.

**How a moment works.** A step may carry `cues`: seconds from its start at which a further moment begins within its lines. Where
a step has cues, its line-keyed fields (surfaces, views, labels, the panel's line, a growth beat's line) count moments instead,
so a label, a surface change and the replay's stage can all land partway through one line, with no empty second line. The
engine's state carries `moments` beside `lines`, and the page says it as `#chapter2[data-tour-moment]`. A step lasts until its
last cue has been read as a line would be. A paused or held step shows every label its last line brought (the still state), so
nothing that arrives on a timer is lost to a visitor who stops; reduced motion keeps the labels without fades.

**Pictures** (SwiftShader, the locally built site, `node packages/website/evidence/map-one-line/capture.mjs` after
`pnpm --filter @storytree/website build`): every moment of both steps at 1440×900, 390×844 and 320×700
(`<width>-<step>-moment-<n>.png`), each step paused near its end (`-paused`), and each without WebGL (`-no-webgl`), plus
`two-steps.webm`, the two steps played through at 1440 at 0.75×. `seen.json` records each picture's moment, its labels and
whether any label crowds the screen's edge, the card, the bar, a panel or an island's name: none does.

- Laptop: [stories paused](1440-map-stories-paused.png) (all four "a story" labels and the pathway), [capabilities paused](1440-map-capabilities-paused.png),
  [the panel's moment](1440-map-capabilities-moment-3.png).
- Phone: the pathway at 390 ([moment 5](390-map-stories-moment-5.png)) and the file at 390 ([moment 2](390-map-capabilities-moment-2.png)), as
  before; a phone never opens the story panel, so it has no panel label, and 320 shows no label on these steps (each would crowd
  an island's name), so the How carries them in words.
- No WebGL: the step's note, the one line and How and why, at [1440](1440-map-stories-no-webgl.png), [390](390-map-stories-no-webgl.png),
  [320](320-map-capabilities-no-webgl.png).

**See:** one line on the left; the islands rising one by one with "a story" beside each; a pathway named where it is drawn; then
inside signing in, "a capability", "each dot is a file", and the panel's diagram outlined with its words beneath it.
**Feel:** less to read; the map is doing the explaining.
**Think:** "stories are islands, they depend on each other by pathways, and each is made of capabilities that hold my files."

**Choices made here.**
- The cart and checkout rise together, as recorded, so that moment labels both: the one place a step shows two labels at once.
- The file label keeps the recorded name and size and leads with "each dot is a file", which teaches the general rule the dropped
  line taught while staying true to the record.
- The panel's label sits beneath its outlined diagram inside the panel: beside the panel it floated over the globe, near the
  island's own labels.
- The capability territories' flash on arrival is not worked around here: it belongs to increment_fbfb586cfd31 (`forest-world`).

**Checks.** `tour.test.ts` 2.16 and 2.21 red then green (one line each, the beats pinned to moments, labels per moment, the still
state); browser journeys `--verify-camera` (2.16 now waits on moments and checks the pathway label and the panel's pointer),
`--verify-tour --verify-forest` and `--verify-immersive` pass.
