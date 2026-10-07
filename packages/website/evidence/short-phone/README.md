# Every tour step fits under the globe on a short phone (increment_94113ddf5036)

Contract 2.19, its room clause extended. Residue of increment_61ad43b96182: on a short phone the longer steps, and the
arrival's fixes slide, scrolled in the room under the globe.

**Before** (`before/`, main at 38fb8272) and **after** (`after/`): the fixes slide and three long steps at 320×700 and
320×568, plus knowledge-reads at 390×844, reduced motion, from the locally built site.

Overflow (the words' scrollHeight minus their room), every one of Act 2's 23 steps:

| Viewport | Before | After |
|---|---|---|
| 320×844 | 6 steps over, fixes by 81 px | none |
| 390×844 | fixes 28, agents-standdown 8, knowledge-reads 16, knowledge-compare 8 | none |
| 320×700 | 11 steps over, fixes by 156 px | none |
| 320×568 | 18 steps over, fixes by 198 px | none |
| 375×667, 375×548, 360×740 | (not measured) | none |

What changed, on a phone only (600 px wide or less):
- The tour measures the room each step's words need (`--tour-room`, set as a step and each of its beats arrive, and on
  resize). The words keep that room, and only a step that needs more than the old 48% line gives the globe's room up, down
  to 31% of the chapter. Short steps keep main's globe, so their tags and panels sit where they did.
- The fixes slide stacks each pain as a small red caption over its fix, with a green rule instead of the two boxes and the
  arrow side by side (`after/fixes-320x700.png`).
- The words end 36 px above the bar rather than 54, still clear of the recording's progress line.
- On a phone 360 px wide or less, the chapters' lines are 16 px (explain mode's floor) rather than 17.

**See:** every step's lines and its How and Why link are on screen together; nothing under the globe scrolls.
**Feel:** on a long step the globe steps back to make room for the words, then returns on the next.
**Think:** "I can read the whole step without fiddling with a tiny scrolling box."

Checks:
- `--verify-immersive` (2.19): every step fits its room at 1920, 1440, 1280, 390×844 and 320×844 (it checked three steps
  before), and at 320×700 and 320×568. Red on main's styles ("fixes 28px, agents-standdown 8px, knowledge-reads 16px,
  knowledge-compare 8px over" at 390px), then green.

Residue (parked on the arc): 2.18's tag check is already red on main at 390×844 (a tag on a ring on agents-parallel), and
throws before 2.19 is reached, so this run was observed with that check skipped locally. On the shortest phones (320×568)
the agents-claim and agents-parallel tags and the sessions list can fall on the words of a long step.
