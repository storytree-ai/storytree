# A selected session's traversal on the core (ADR-0756)

Increment `increment_5d33661e9ce5`. Selecting a session's row draws its window as one line per step, in reading order, in the session's colour: solid where the library stores a link between the two notes, dotted where none does. A new step grows toward its note; then a faint fill runs along each line from the earlier note to the later, like a progress bar. A note whose read is still in the window has the warm white ring; one compacted out since is lighter, and its line fades with it; a note only glimpsed is tinted faint, with no line.

- [No session selected](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/traversal/0-none-selected.png)
- [Selected, reduced motion: faded solid line from the compacted read (top, short), solid line along a stored link, dotted jump](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/traversal/1-selected.png)
- [Selected, motion on: the fills running](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/traversal/2-fill.png)
- [Ten frames, 260 ms apart, after a fifth open arrives: its dotted line grows, then fills](https://github.com/storytree-ai/storytree/blob/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/traversal/3-grow-and-fill-strip.png)
- [What the capture asserted](capture.json)

**Since ADR-0797 (2026-10-02 re-run):** with motion on, a selected session replays its steps instead of growing and filling them (see `../replay`), so the capture now runs the reduced-motion part only; the motion pictures above show the retired look and are not re-taken.

The real desktop page in headless Chromium (SwiftShader) on Linux at 2x, over the forest snapshot with one synthetic session reading four real shelf-placed notes (the snapshot stores only two links between them, which fixes the chain) and a synthetic window reading. The camera framing of the strip is rough: the lines are small in it.

```sh
node packages/forest/evidence/sessions-list/build.mjs
node --import tsx packages/knowledge-core/evidence/traversal/capture.mjs
```

Screenshots removed from `main` on 2026-10-23, their arc closed (the owner's answer to question_5125601c0789, under ADR-1123): 4 pictures, each one's last copy kept in git history at [this folder](https://github.com/storytree-ai/storytree/tree/5b961a327e879607c1f79daca593a4f50a53aa24/packages/knowledge-core/evidence/traversal).
