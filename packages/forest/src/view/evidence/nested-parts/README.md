# Zooming into a capability opens it into its code's parts (contracts 3.112 to 3.115)

Mick, by voice 2026-11-15 (voice.note_ea22e86d5ceb): "the pathways moving from one capability into another, which
currently go to a centralized node, would break apart. And suddenly that node would disappear, and instead you would get
multiple smaller territories inside that capability as you zoom in."

What this draws: past the parts level (five times the near zoom), the capability under the middle of the view opens. Its
outermost code parts (the survey's, a folder with its own entry file) and its own files in no part are laid out inside its
land on a fine cut of their own, each sized by its lines; their borders are drawn as lines and they keep the capability's
health colour (question_211620bd75de). The island's roads into it carry on from where they cross its border to the parts
their files reach, through small gate posts of their own, and its centre junction gives way to each part's. Each part is
named. One capability is open at a time, and its marks are four draws however many parts it has. Zoomed out, nothing of it
is drawn and the island is exactly as before; each island gate on a capability's border carries the count of part roads
it rolls up.

The library's island alone (every island of storytree's map laid out from nothing took this box over twenty minutes),
from a fresh seed and code survey built from the library and this branch's checkout: the committed snapshot predates the
survey's parts. Three of its capabilities hold parts today: 13 · Decision log (commands, knowledge, librarian),
14 · Ranked search (knowledge, project) and 2 · Library transactions (project, transactions).

Counted from the scene and the page (`after-measurements.json`):

| view | parts | draws added | gate posts | territory junctions shown | gates carrying a roll-up | part names |
|---|---|---|---|---|---|---|
| the library, closed (4 × near zoom) | none open | 0 | 0 | 26 | 11 | none |
| 13 · Decision log opened | 3 | 4 | 4 | 25 | 11 | commands, knowledge, librarian |
| 14 · Ranked search opened | 2 | 4 | 2 | 25 | 11 | knowledge, project |
| 2 · Library transactions opened | 2 | 4 | 2 | 25 | 11 | project, transactions |

Taken by `node --import tsx packages/forest/testing/view/nested-parts/capture.mjs after` (append `--retake` to write here).

In the evidence bucket for #882, linked from the pull request body (ADR-1234; deleted after 90 days or when its arc closes): `882/after-the-library-closed.png`, `882/after-13-decision-log-opened.png`, `882/after-14-ranked-search-opened.png`, `882/after-2-library-transactions-opened.png`, `882/after-measurements.json`.

## Roads that come round a part's front door (contract 3.120)

What this adds: on an opened capability, a part road that an import reaching round a part's entry rides on (the survey's
clashes) is drawn in a clash tint (`CLASH`, an amber), and so are both posts of its gate into the part it reaches; where
the part reached lies deeper than the parts shown, the road is named "into <part>" at that gate, or midway along it when
it has none (a road out of the capability). The marks add no draw: still four. A road with no clash is drawn as before.

Same library-only capture, opening the three library capabilities with the most clash roads (`--clashes`), each road
listed by the key it is routed by (`arrive:k->part` in, `part->leave:k` out):

| view | parts | draws added | gate posts | tinted posts | clash roads drawn | road names |
|---|---|---|---|---|---|---|
| 6 · Knowledge artifacts opened | 2 | 4 | 2 | 2 | arrive:0->src/knowledge, src/knowledge->leave:0, src/project->leave:0, src/project->src/knowledge | into src/schema, into src/schema |
| 4 · Work model opened | 2 | 4 | 2 | 2 | arrive:1->src/work, (its own files)->leave:0, src/work->leave:0 | into src/schema, into src/schema |
| 7 · Library API opened | 2 | 4 | 2 | 2 | (its own files)->leave:0, src/api->leave:0, src/api->leave:2 | into src/work, into src/work, into src/project |

Knowledge artifacts and Work model reach round Data schema's entry into `src/schema`, and Library API round Work model's
into `src/work` and Factory and product's into `src/project`; those parts lie in other capabilities, so each is named by
its whole folder. A road that reaches the part it enters (project into knowledge) is tinted and not named.

Taken by `node --import tsx packages/forest/testing/view/nested-parts/capture.mjs clashes --clashes --capabilities 3`.
