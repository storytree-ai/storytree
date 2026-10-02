# Every listed session's code reads, drawn with none selected (ADR-0875)

With no session selected, each surveyed code file a listed session's window opened is now a stop on its reading path: its flat circle on the land lights in the session's colour (a full fill, no in-view ring), a file-to-file step is a hop over the land, and a file-to-note step is a dive into the core. Two sessions: "Light the code with none selected" (`builder`, cyan) reads three knowledge-core files, a note, then forest's `file-circles.ts`; "Review the file circles" (`traversal-a`, violet) reads a note, three forest files including `file-circles.ts`, then a note. Both first readings tie on `file-circles.ts`, which then wears violet; a later reading in which `builder` opens it again hands it to cyan, its latest reader.

- [No session selected: the whole globe, both sessions' hops and dives, their file circles lit](0-none-selected.png)
- [The knowledge core facing, zoomed: three cyan file circles, the hops between them, and the dive to the note under the agent link](1-knowledge-core.png)
- [The forest facing, zoomed, after the later reading: `file-circles.ts` (left, cyan) wears its latest reader's colour; `planet-view.tsx` and `forest-view.tsx` violet, with violet hops to it and dives out](2-forest-later-reader.png)
- [What the capture asserted and read from the scene](capture.json)

Asserted from the scene's userData: each opened file's circle carries a `file-lit:<path>` child with `userData.window === 'read'`, in its reader's colour, and no other circle is lit; no `file-ring:` child exists; every step of both windows is drawn as a `knowledge-trail:` with `kind` `hop` (file to file), `dive` (file to or from a note) or none (note to note), and every `knowledge-trail:file:…` is a hop or a dive; the shared file wears the later reader's colour after the later reading; no page errors.

The real desktop page in headless Chromium (SwiftShader) on Windows at 2x, over the eight-story snapshot (`knowledge-under-islands/seed.json`) and its code survey (`traversal/survey.json`), with synthetic sessions and window readings. The page is built by `packages/forest/evidence/sessions-list/build.mjs`.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node --import tsx packages/knowledge-core/evidence/window-files-all-sessions/capture.mjs --retake
```
