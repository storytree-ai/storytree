# A selected session's window on the core (ADR-0746 D1)

Increment `increment_a308cd8414aa`. The agent link folds a session's transcript into its window (contract 9.10): what it holds now (after the last compaction, leaving out subagent side chains), the call that brought each piece, and, for each note or file it opened, the earlier results already in view that held the id. Selecting a session's row draws that window on the globe's knowledge dots:

- a warm white ring on each note the session holds now; a note it read before a compaction keeps its lit dot and its reading path but loses its ring;
- a straight, dotted, warm white line with no head from a note to one opened while that note's result, holding the id, was in view. It means "was in view", never "followed" (ADR-0740 D3). An open that came from a search draws no line.

With no session selected no window is drawn, and no one session's window is asked for (every listed session's window is read in one batch for the all-sessions view, ADR-0754 D1). The colour is one no session wears: session colours are 80% saturated hues.

- [No session selected](window-none-selected.png)
- [The session selected: five rings, three in-view lines, beside its reading-path curves](window-selected.png)
- [What the capture asserted](capture.json)

Files the session holds are in the reading but not drawn: the globe has no place for a file.

These are the real desktop page in headless Chromium (SwiftShader) on Linux, over the forest snapshot with one synthetic session reading six real shelf-placed notes and a synthetic window reading.

**Since ADR-0756 (2026-10-02 re-run):** the dotted in-view lines are gone; a selected session draws its traversal instead (see `../traversal`). The capture now checks the rings and that no in-view line is drawn; the pictures above are from before, re-taken only with `--retake`.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node --import tsx packages/knowledge-core/evidence/window/capture.mjs
```
