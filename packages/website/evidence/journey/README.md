# Chapter 2 from the visitor's seat (ADR-0879)

Pictures of the tour as a visitor meets it, from the locally built site (`pnpm --filter @storytree/website build`, then
`node packages/website/evidence/journey/capture.mjs`), at 1440×900 and 390×844, in headless Chromium with software WebGL.
Each line says what the visitor sees, feels and thinks, and the design move that answers it (ADR-0879 D1).

The tour opens on storytree's busy globe, then cuts the map down to **Conduit** (ADR-0879 D7): the RealWorld blogging
site the test laptop's Codex built with storytree on 1–2 October 2026 (`conduit-codex`; `packages/app-setup/evidence/first-build/`).
Conduit's globe grows from its own saved library, a recorded stage at a time (`src/conduit-snapshot.json`, refreshed by
`src/refresh-growth.ts`): its five frontend stories, their roads, each part's session claiming and landing it, a CI story,
then a backend arc that grows it to twelve islands. Its code is not laid out one package per story, so storytree drew no
land for it: its islands are plain, and the land-level ideas (territories, file circles, health checked by CI), the
knowledge core and reading paths are shown back on storytree's own globe, "At full scale".

| Picture | Sees | Feels / thinks | Move |
|---|---|---|---|
| `*-0a-finale` | Chapter 1's honest finale on the phosphor terminal | "What better way?" | One primary key |
| `*-0b-turn`, `*-0c-arrival` | The terminal switches off into a point; storytree's globe grows in from far away, every surface on | Calm after the noise; awe at the size | The first words wait 1.5 s so the globe lands first |
| `*-1-opening` | ADR-0853's problem, one sentence at a time, in large type over the busy globe | "That's what I just watched" | The busy globe is the noise the words describe |
| `*-2-principles` | Four numbered principles; at "Show what matters now" the globe's surfaces fade to plain islands | Relief: "show me how" | The principle is shown, not told |
| `*-3a-grow-empty` | The camera pulls back, the busy globe swaps for a small empty glass one: "This is Conduit, a blogging site that Codex built…", dated | "Simple, I can follow this"; "a blogging site, like what I'd build" | Cut down to a smaller real project, labelled as a replay of its own library |
| `*-3b-grow-stories` | Five islands appear as the line "its agent wrote five stories" arrives, and the camera flies in | "My app's features, as islands" | The globe grows with the words; the full plan fixes each island's spot (forest 3.28) |
| `*-4-story` | One island ringed: "a story: Discover articles"; the card names all five | Recognition: these are things a reader does | Real story names, not jargon |
| `*-5-roads` | "Read and publish articles" selected, its lanes drawing on: blue to what it builds on, violet to what builds on it, neighbours ringed | "Change one, see who feels it" | The app's own dependency-lane motion, on a chain short enough to follow |
| `*-6-contracts` | The agent's own first note, quoted: it reported the test failing ("index.html must exist") before any code | "So 'done' was defined first" | A real red-then-green, flagged as the agent's report |
| `*-7-conduit-health` | All five parts landed; the card says every contract reads passing on its agent's word, and the official RealWorld suite passed 139 of 139, with its source | Trust that it doesn't overclaim | The agent's word and the outside proof, side by side |
| `*-8-compare` | Three plain lines: what two other tools do, what storytree does, each with its source | Fairly placed among tools they know | Sources and date one tap away |
| `*-9-claim` | Discover articles wearing a session's colour, tagged with its real claim: "Build part 1 home feed" | "That's an agent working, and I can see where" | Claims drawn as the app draws them, from the recording |
| `*-10-landing` | The colour hops: part 1 lands, part 3's session holds Read and publish articles, then all five have landed by 00:31 | "This is how the agents worked, in order" | Stages advance with the lines, one session per part |
| `*-11-close` | Twelve islands; one backend session's colour on two of them (its part and the CI pipeline) | "One session, its claims, then it closes out" | The real shape of a backend session |
| `*-12-arcs-plan` | A new island arrives on its own: "Review changes with official CI" | "The plan grew as the work did" | The arc's next increment, as a new story |
| `*-13-arcs-grow` | Six backend islands, the roads rewired; Backend: Articles selected, the frontend islands ringed violet | "Plan first, then build"; "the frontend stands on this" | A second arc grows the globe from five islands to twelve |
| `*-14-arcs-landed` | Colours move across the backend islands part by part, then all clear | "One pull request at a time" | Waiting work shows as waiting, never as progress |
| `*-15-return` | The camera pulls back and storytree's own globe returns, its land cut into territories: "Conduit's code isn't laid out one package per story, so storytree drew no land for it." | "The same ideas, on a project with its code drawn" | The honest limit said where it matters; land shown where it exists |
| `*-16-health-depth` | The library's untested card in the app's own panel ("You move this one"), the step's depth open on the card | Trust: it says who said so, and why | CI's verified column here, against Conduit's agent's word earlier |
| `*-17-questions` | The app's arc surface: storytree's arcs, increments, and what waits on the owner | "Only real decisions wait on me", the callback to chapter 1's twelve agents | The plan as the app shows it, at full scale |
| `*-18-knowledge` | The notes as points inside the glass globe: 785 notes, 223 decisions | "It remembers, and I can see where" | The glass ball stays, so "inside" reads |
| `*-19-reads` | A recorded session's reading path through the library, the sessions list replaying, marked as a recording | "I can see what the work stood on" | Recorded, never live; never invented |
| `*-20-exploring` | After a drag: the play button lit, "Waiting while you explore" | In control, not lost: "I can come back" | One press flies back and continues the step |
| `*-21-everything` | The busy globe from the start, every surface back | "Now I can read it" | A bookend to the opening |
| `*-22-freeplay` | The desktop's surfaces on storytree's globe, "Free play · storytree's own project, saved 2 October 2026 · read only", Replay, Join the waitlist | "I want this for my project" | The waitlist is one obvious button |

## Motion

Headless screenshots take most of a second each with software WebGL, so they cannot show a flight. Sampled in the page
instead (requestAnimationFrame, the spread of the nameplates on screen as a measure of zoom):
- **Storytree → Conduit** (principles → Each island is a story): the camera pulls back for about a second (spread
  696 → 374 px), the globe swaps while small (1.1 s, Conduit's five plates at 172 px), then dives in, settling at
  2.7 s (624 px) with no jump.
- **Conduit → storytree** (Planners compare → Back on storytree's globe): pull back for a second (578 → 327 px), the
  swap (one long frame of about 0.7 s while software WebGL builds storytree's land), then the dive, settling at 3.3 s.
- The website island → files flight (unchanged): the camera turns while pulling back for about a second, then dives in,
  settling about 2.4 s after the click with no jump.

## Checks

`node packages/website/evidence/capture.mjs chapter2 --verify-tour` (contracts 2.4–2.8, phone, no WebGL),
`… chapter2 --verify-camera` (2.9 with the live globe: Conduit opens empty, its five stories appear as the step is read,
the backend arc grows it to twelve islands, the steps at scale return to storytree's; 2.4, 2.7: exploring holds and says
so, Play returns within 5 px), `… immersive --verify-immersive` (1440/390/320: bar along the bottom, 44 px targets on a
phone, the hatch never covers a control or a pip, no sideways scroll, free play as the desktop) and
`… recording --verify-recording` (the recording follows the tour's speed; depth stays above the app's drawers).
