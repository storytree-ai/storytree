# Every running session on the core (ADR-0738)

Increment `increment_e7d28849c36b`. With no session selected, the globe's knowledge dots light in the colour of each running session in the sessions list (the colour its row and wisps wear), since the session started, with no fade. A subagent's reads wear its parent's colour. A note two listed sessions read gets a white halo, and its colour is the latest reader's. Clicking a row drills into that session alone: its orchestrator wears the session's colour and each subagent a shade of that hue. Clicking the row again goes back to every session.

- [No session selected: three sessions, four shared notes](all-sessions.png)
- [One session selected](one-session.png)
- [Drilled into a session with an explorer subagent: a darker shade of the same hue](drill-in-shades.png)
- [What the capture asserted](capture.json)

These are the real desktop page in headless Chromium (SwiftShader) on Windows, over the forest snapshot with three synthetic sessions reading real shelf-placed notes.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node packages/knowledge-core/evidence/all-sessions/capture.mjs
```
