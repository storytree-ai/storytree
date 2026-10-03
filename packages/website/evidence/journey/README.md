# Chapter 2 from the visitor's seat (ADR-0879)

Pictures of the tour as a visitor meets it, from the locally built site (`pnpm --filter @storytree/website build`, then
`node packages/website/evidence/journey/capture.mjs`), at 1440×900 and 390×844, in headless Chromium with software WebGL.
Each line says what the visitor sees, feels and thinks, and the design move that answers it (ADR-0879 D1).

| Picture | Sees | Feels / thinks | Move |
|---|---|---|---|
| `*-0a-finale` | Chapter 1's honest finale on the phosphor terminal | "What better way?" | One primary key |
| `*-0b-turn`, `*-0c-arrival` | The terminal switches off into a point; storytree's globe grows in from far away, every surface on | Calm after the noise; awe at the size | The first words wait 1.5 s so the globe lands first |
| `*-1-opening` | ADR-0853's problem, one sentence at a time, in large type over the busy globe | "That's what I just watched" | The busy globe is the noise the words describe |
| `*-2-principles` | Four numbered principles; at "Show what matters now" the globe's surfaces fade to plain islands | Relief: "show me how" | The principle is shown, not told |
| `*-3-story` | The camera on one island, ringed: "a story: The website" | Oriented: "features as islands; this is the site itself" | One thought per line; the bar shows how far there is to go |
| `*-4-roads` | The agent link selected, its lanes drawing on: blue to what it builds on, violet to what builds on it | "Change one, see who feels it" | The app's own dependency-lane motion |
| `*-5-health-depth` | The library's untested card in the app's own panel ("You move this one"), the step's depth open on the card | Trust: it says who said so, and why | Depth is pulled from the card, never pushed; the bar says the tour is waiting |
| `*-6-compare` | Three plain lines: what two other tools do, what storytree does, each with its source | Fairly placed among tools they know | Sources and date one tap away |
| `*-7-knowledge` | The notes as points inside the glass globe, under the islands | "It remembers, and I can see where" | The glass ball stays, so "inside" reads |
| `*-8-sessions` | The recording's sessions listed and tinting their islands, dated, marked as a recording | "Agents at work, and I can see who is on what" | Recorded, never live; never invented |
| `*-9-exploring` | After a drag: the play button lit, "Waiting while you explore" | In control, not lost: "I can come back" | One press flies back and continues the step |
| `*-10-questions` | The app's arc surface: arcs, increments, and what waits on the owner | "Only real decisions wait on me", the callback to chapter 1's twelve agents | The plan as the app shows it |
| `*-11-everything` | The busy globe from the start, every surface back | "Now I can read it" | A bookend to the opening |
| `*-12-freeplay` | The desktop's surfaces, "Free play · storytree's own project, saved 2 October 2026 · read only", Replay, Join the waitlist | "I want this for my project" | The waitlist is one obvious button |

## Motion

Headless screenshots take most of a second each with software WebGL, so they cannot show a flight. Sampled in the page
instead (requestAnimationFrame, The world's nameplate, website island → capabilities-files): the camera turns while
pulling back for about a second, then dives in, settling about 2.4 s after the click with no jump.

## Checks

`node packages/website/evidence/capture.mjs chapter2 --verify-tour` (contracts 2.4–2.8, phone, no WebGL),
`… chapter2 --verify-camera` (2.4, 2.7 with the live globe: exploring holds and says so; Play returns within 5 px),
`… immersive --verify-immersive` (1440/390/320: bar along the bottom, 44 px targets on a phone, the hatch never covers a
control, no sideways scroll, free play as the desktop) and `… recording --verify-recording` (the recording follows the
tour's speed; depth stays above the app's drawers).
