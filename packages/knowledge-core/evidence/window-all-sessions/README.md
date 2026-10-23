# Every listed session, drawn from its window (ADR-0754 D1)

Increment `increment_81d266399588`. With no session selected, each listed session is now drawn from its window reading (agent link 9.10), the same reading the selected view uses, so a session that reads the library by command line (`storytree library read <id>`) lights up although it writes no note-read line. Each opened note lights in the session's colour, with a curve from each opened note to the next (ADR-0740). A new open grows its line, the note lights when the line arrives, and a glow replays each path (ADR-0742). A note two sessions opened wears one ring arc per session (ADR-0754 D2). A session with no window falls back to its log's note-read lines. Glimpses and files are left to the selected view.

- [No session selected: two sessions drawn from windows alone, one from its log; one shared note](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/window-all-sessions/0-none-selected.png)
- [Ten frames, 200 ms apart, after a later reading adds an open to "Build the traversal view"](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/window-all-sessions/1-grow-strip.png)
- [Motion on: the glows running](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/window-all-sessions/2-glow.png)
- [What the capture asserted](capture.json)

The real desktop page in headless Chromium (SwiftShader) on Windows at 2x, over the forest snapshot, with three synthetic sessions and synthetic window readings.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node --import tsx packages/knowledge-core/evidence/window-all-sessions/capture.mjs
```

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 3 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/window-all-sessions).
