# With none selected, the five latest working sessions are drawn (ADR-0878)

With no session selected, the knowledge core draws at most five listed sessions: those not idle, latest seen first. Seven are listed: six working, each with a prompt at a different recent time (`builder` 2 minutes ago, `traversal-a` 4, `reviewer` 6, `lane-north` 8, `curator` 10, `scout` 12), and one idle (`lane-south`, whose turn ended 45 minutes ago: past the 30-minute idle-after, inside the 60-minute leave-after). Each window reads a note, a surveyed file and another note that no other window reads, so every lit thing names one reader.

- [None selected: the five latest working sessions' trails, notes and file circles drawn in their colours; the list shows six working rows and the opened "1 idle" fold with the seventh](0-none-selected.png)
- [The oldest working session ("Survey the oldest lane", `scout`, magenta) selected: its two steps and its window drawn in its colour](1-oldest-selected.png)
- [What the capture asserted and read from the scene](capture.json)

Asserted from the scene's userData: the seven sessions wear seven colours; the list holds all seven rows (the idle one folded under "1 idle" until the fold is opened, then shown with `data-idle`); with none selected every `knowledge-trail:` wears one of the five drawn sessions' colours and each of the five draws trails; the lit notes are exactly the five sessions' notes, each in its reader's colour, and the lit file circles exactly their five files; neither `scout`'s nor `lane-south`'s colour appears on any trail, note or circle, and neither window was asked for; with `scout`'s row clicked (`data-selected`), its two notes carry its colour as window state, its two trails and its file circle wear its colour, and all seven rows remain; no page errors.

The real desktop page in headless Chromium (SwiftShader) on Windows at 2x, over the eight-story snapshot (`knowledge-under-islands/seed.json`) and its code survey (`traversal/survey.json`), with synthetic sessions and window readings. The page is built by `packages/forest/evidence/sessions-list/build.mjs`.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node --import tsx packages/knowledge-core/evidence/five-latest-sessions/capture.mjs --retake
```
