# The chapters keep the arrival's format, and the agents chapter opens on its sessions (increment_61ad43b96182, part 1)

Contracts 2.19 (new) and 2.17 (reworded). The owner, reviewing the live site on 2026-10-05 (ADR-0890 and ADR-0893, amended
that day): "I dislike how we change the format between the intro and the chapters to a card with bullet points ... we can
keep the how and why button but maybe just remove the card, and the only thing we change is the size of the text";
and of the agents chapter's first step, "a replay of our promised fix, dont think this is needed".

**Before** (`before/`, main at b6847102) and **after** (`after/`): the fixes slide, then every step of the map and agents
chapters, at 1920×1080, 1440×900, 1280×800, 390×844 and 320×700, played in order with motion, plus each width's
map-parts step with its How and Why open. They come from the locally built site:
`node packages/website/evidence/arrival/capture.mjs --only chapters [--to one-format/before --dist <main's dist>]`.

| | Before | After |
|---|---|---|
| A chapter step, laptop | A bordered card, bottom left: kicker, a title, three bulleted 15.5 px lines, a How and why button | No card: the kicker, then the lines as plain sentences over the same dark scrim the arrival uses, 18 to 23 px (the arrival's impact lines are 25 to 38 px), lined up with the arrival's left edge; How and why is the arrival's underlined link beneath them (`after/1440-map-code.png`) |
| How and why open | Inside the card | Beneath the lines, as before, still holding the tour while it is read (`after/1920-map-parts-depth.png`) |
| A chapter step, phone | The card under the globe, often scrolling (320×700: 67 to 180 px over) | Plain lines under the globe at 17 px, 16 px on a short phone; they scroll less than before on every step (320×700: most map and agents steps fit or are 7 to 49 px over) |
| Agents chapter, step 1 | "What storytree fixes": the fix replayed | Its sessions strip ("Storytree lists your conversations with AI here as active sessions."); the chapter is 5 steps (`after/1440-agents-sessions.png`) |
| Tags on the agents steps | — | Still clear of each other, the rings, the lines and the panels at all five widths (2.18's check passes) |

The globe sits 14 to 20 px further right on a laptop, because the lines now start where the arrival's do.

**See:** the tour reads as one voice from the pain to the agents chapter. Big lines in the arrival, smaller ones in the
chapters, in the same place, with no box around them.
**Feel:** calmer and less like a slide deck. The globe is the main thing on screen, and the words narrate it.
**Think:** "it's telling me a story about this shop", not "here are three facts".

Checks:
- `--verify-immersive` (2.19, new) checks map-parts, agents-sessions and knowledge-kinds at 1920, 1440, 1280, 390 and 320. Each must have no card (transparent, no border, no shadow), no bullet points, and lines smaller than the arrival's pain lines but at least 16 px, with How and why beneath the lines and everything fitting without scrolling. It was red on main at 1920 (card, 3 bullets, 15.5 px), then green.
- `tour-reading.test.ts` 2.17: the agents chapter opens on the sessions strip. It was red with the fix replay, then green.

Residue (parked on the arc): on short phones (320×700 and smaller), the longer steps still scroll a little in the space
under the globe. So does the arrival's fixes slide, which already did on main.
