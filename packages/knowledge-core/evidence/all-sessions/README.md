# Every running session on the core (ADR-0738)

Increment `increment_e7d28849c36b`. With no session selected, the globe's knowledge dots light in the colour of each running session in the sessions list (the colour its row and wisps wear), since the session started, with no fade. A subagent's reads wear its parent's colour. A note two listed sessions read wears the latest reader's colour; since ADR-0754 D2 a ring of one arc per reader replaces the white halo these pictures show (see [../shared-note](../shared-note/README.md)). Clicking a row drills into that session alone: its orchestrator wears the session's colour and each subagent a shade of that hue. Clicking the row again goes back to every session.

Each session's reading path draws too (ADR-0740): a curve from each full read to the same agent's next, in the session's colour (or the agent's shade once drilled in), bowed away from the globe's centre, fading from dim at the earlier read to full at the later one. A curve means "read next", never a followed link.

A new step's line grows from its earlier read to its later one as it is read, and each known agent's path is replayed in a loop by a glow travelling its steps in recorded order, bright at its head and fading behind (ADR-0742). Paths carry no arrowheads. Opening the view grows nothing; with reduced motion nothing grows or glows.

- [No session selected: three sessions, four shared notes](all-sessions.png)
- [One session selected](one-session.png)
- [Drilled into a session with an explorer subagent: a darker shade of the same hue](drill-in-shades.png)
- [A new step's line growing](path-growing.png)
- [The paths' looping glow](path-glow.png)
- [What the capture asserted](capture.json)

These are the real desktop page in headless Chromium (SwiftShader) on Windows, over the forest snapshot with three synthetic sessions reading real shelf-placed notes.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node packages/knowledge-core/evidence/all-sessions/capture.mjs
```
