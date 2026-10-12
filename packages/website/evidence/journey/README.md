# The whole journey from the visitor's seat (ADR-0879)

Pictures of the site as a visitor meets it today, from the locally built site (`pnpm --filter @storytree/website build`, then
`node packages/website/evidence/journey/capture.mjs`, or `… --check` to write them to a temporary folder instead), at 1440×900
and 390×844, in headless Chromium with software WebGL. Re-recorded 2026-10-12 (increment_2d56c9a17380) on main at 59f04ebb.

The capture walks chapter 1's finale and turn, then every step of Act 2's tour by its id (`#tour-pips [data-step]`, from
`src/tour-copy.ts`), never by its wording, then free play on the shop and on storytree's own project. It fails when the
tour's steps are not the fifteen it expects, in order, or when a step runs on before it is paused: a reshaped tour is a red
run, not stale pictures. Each step is pictured as it settles (its pip at least 88% full, the tour paused there), played at
1.5×; free play's storytree picture waits until its names are drawn.

Each row says what the visitor sees (read from the pictures, not the copy), what they likely feel and think, and the design
move that answers it (ADR-0879 D1). Where a picture shows a step failing, the row says so and names the increment parked for it.

| Picture | Sees | Feels / thinks | Move |
|---|---|---|---|
| `*-0a-finale` | Chapter 1's green terminal: twelve agents' windows, every one "waiting on you", and the honesty window on top: "I know a better way: a map that shows you where to look." with one lit key, "show me where to look →" | "That is my week"; "show me" | One primary key; the alternative ("i'll keep babysitting") is dim |
| `*-0b-turn` | The terminal gone; a single point with a faint green glow in the dark | Calm after the noise; "something starts here" | The screen powers off into the point the globe grows from |
| `*-01-pain` | Dark screen, no globe yet: "Right now, building with AI feels overwhelming, exhausting and disconnected." then, in green, "Storytree is here to fix that." The tour bar along the bottom, paused | "Yes, that's it"; relief that it is named | The words before any picture; the globe waits for them (its setup hides behind this beat) |
| `*-02-grow` | Storytree's own globe, grown from its records: about twenty named islands, roads, flags, the knowledge dots between them; "This is storytree, a living map of your project, for both you and your agents.", dated 25 Sep to 4 Oct, "timing compressed" | Awe at the size; "this is real, not a mock-up" | Storytree built with storytree, replayed from its own records and dated |
| `*-03-value` | The same globe whole beside "Storytree builds a map of your project and glues it to your code. The map grows as your agents work, and says what needs you and what doesn't." | "So the map is the point" | The value statement alone, in the largest type of the tour. On a laptop The world's name sat under the tour bar and The app setup's ran off the right edge, fixed since by increment_6da857f8ab07 (evidence/own-globe-laptop); on a phone the compass sat over the globe's right side, fixed since by increment_b7d9fb526564 (evidence/own-globe-phone) |
| `*-04-fixes` | Three pains in red ("No idea what your agents built", "Agents colliding in a void of code", "Agents forgetting why it was built that way"), each with an arrow to its fix in green | "Each of my problems has an answer" | Pain to fix, side by side, with the globe still behind |
| `*-05-map-empty` | The cut to the shop: a small empty glass globe, "The map · 1 of 7", "Let's start from the beginning and build a shopping site…", the note dated 5 October | "Small enough to follow" | Cut from the big globe to an empty one; the shop's growth is replayed from its own records |
| `*-06-map-harness` | Still empty; "Storytree works with your existing coding harness." with Claude Code's and Codex's marks, "Any other agent that speaks MCP can use the plan too." | "It works with what I already use" | Each harness by its own mark; only the ones the setup check verifies (the other marks wait on the arc) |
| `*-07-map-arcs` | The arcs drawer open over the empty globe: one active arc, "Swag Labs copy", "ready · 4 to take", tagged "a plan of work: an arc" | "Plan first, before anything is built" | The plan as the app shows it, before any island |
| `*-08-map-stories` | Four grey islands with their roads: Cart, Checkout, Browsing, Signing in, each "0 / n landed"; tags "a story" and "a pathway: the cart needs signing in" | "My app's features, as islands"; "the cart needs signing in, makes sense" | Real story names, not jargon; the road says what depends on what. The pathway tag sits over the Cart island (increment_f7ae1afd5735) |
| `*-09-map-capabilities` | Laptop: flown into Signing in, its territories with file dots, "each dot is a file: server.js · 110 lines", and the story panel's diagram of its eight capabilities, "how its capabilities work together". Phone: the same island small, the file tag, no panel | "So that's where the code is"; on a phone, the step is mostly words | One line on the card, depth in How and why; the panel only where there is room (above 600px) |
| `*-10-map-claims` | The cart's and checkout's islands with flags in their sessions' colours, Browsing's red flags, the sessions list (parts 2, 3, 4), "RECORDING · 02:28 UTC · 73 of 338 events" | "I can see who is working where, and nobody collides" | Claims as flags from the recording, the same sessions in the list. On a laptop Signing in sits under the sessions list; on a phone the list covers the cart and checkout, whose flags the step is about (increment_5f5a7f86246d) |
| `*-11-map-health` | All four islands green, Checkout ringed "tests passed"; "Yellow means nothing has proved it yet; green means its tests passed." | Trust: "it only goes green when CI says so" | Health comes from CI, said in one colour rule |
| `*-12-knowledge-inside` | The islands dimmed to grey and the notes as dots inside the glass, gathered beneath the islands they are about | "It remembers, and I can see where" | The glass stays, so "inside the globe" reads |
| `*-13-knowledge-shelf` | Laptop: flown to Checkout, its decision open in the panel: "Finish becomes a form post; the cart is cleared on the complete page, not on the click". Phone: Checkout and its dots, the decision in the words | "A real reason, written down where the code is" | A real decision from the shop's record, on the part it shaped |
| `*-14-knowledge-reads` | The session building orders (Part 6) highlighted in the sessions list, a line from Checkout to the note it read, "Only then did it claim checkout's parts. Nobody had to paste it into a prompt." | "The next agent reads it first, by itself" | The reading path replayed from the recording, never invented |
| `*-15-everything` | Storytree's own globe back, every surface on: territories in health colours, flags, roads, the knowledge dots; "Everything is back… It's the globe you started on. Now you can read it.", "Nothing is out of reach" | "Now I can read it" | A bookend to the growth at the start. On a phone the compass covered The MCP server's name, fixed since by increment_b7d9fb526564 (evidence/own-globe-phone) |
| `*-16-freeplay-shop` | Free play on the whole shop: eight green islands named (Checkout, Reviews, Cart, Orders, Admin, Browsing, Accounts, Signing in), Stories / Library, Find, the Project selector with "The shop" lit, the arcs and sessions bars, "Free play · an online shop agents built with storytree, recorded 5 October 2026 · read only", Replay, Join the waitlist | "Now I can poke around the thing I was shown"; "I want this for my project" | Opens on the shop just learned; the waitlist is the one bright button. On a laptop Signing in's name is under the sessions tray (increment_5f5a7f86246d) |
| `*-17-freeplay-storytree` | After choosing storytree: its own busy globe, health colours and names, the sessions tray with four sessions, "storytree's own project, saved 11 October 2026 · read only" | "And this is the real, big one" | Depth for those who want it, one tap away. On a laptop The world's name stood in the bottom bar, fixed since by increment_6da857f8ab07 (evidence/own-globe-laptop); on a phone The website's and Reading the front doors' names ran off the left edge, fixed since by increment_b7d9fb526564 (evidence/own-globe-phone) |

With software WebGL, storytree's globe in free play is grey and nameless for some seconds after the switch before its names
and health colours draw (about 8 seconds on the Mint box); the capture waits for them.

## Checks

The website's browser journeys, on this branch's build: `node packages/website/evidence/capture.mjs chapter2 --verify-tour`,
`… --verify-camera`, `… immersive --verify-immersive` and the forest journey (`node packages/website/evidence/forest.mjs`:
keyboard, phone widths, reduced motion and the no-WebGL still).
