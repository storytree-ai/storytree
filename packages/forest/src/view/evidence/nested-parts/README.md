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
the part reached lies deeper than the parts shown, the road is named "into <part>" at that gate. The marks add no draw:
still four. A road with no clash is drawn as before.

Same library-only capture, opening the three library capabilities with the most clash roads (`--clashes`):

| view | parts | draws added | gate posts | tinted gate posts | clash roads drawn | part names | road names |
|---|---|---|---|---|---|---|---|
| 6 · Knowledge artifacts opened | 2 | 4 | 2 | 2 | src/project -> src/knowledge | knowledge, project | none |
| 4 · Work model opened | 2 | 4 | 2 | 0 | none | work, 4 · Work model | none |
| 7 · Library API opened | 2 | 4 | 2 | 0 | none | api, 7 · Library API | none |

Knowledge artifacts shows the mark: project imports knowledge round its front door, so that road and its gate posts are
amber. None of the library's drawn roads reaches a part deeper than the ones shown, so no road name appears in these
pictures; 3.120's test pins the name and where it stands. The library's deeper reaches (Knowledge artifacts and Work
model into Data schema's `src/schema`, Library API into Work model's `src/work`) ride on roads out of the opened
capability that its crossings do not carry in today, so those roads are not drawn inside it at all (parked on this arc).

Taken by `node --import tsx packages/forest/testing/view/nested-parts/capture.mjs clashes --clashes --capabilities 3`.
