# Session traversal shows only for a selected session (ADR-0921)

The owner, 2026-10-05: "Can we hide active session traversal, I think i need to reverse this decision and only show session traversal when you select a session, its too noisy otherwise."

Storytree's own globe (the code-rows snapshot and its code survey, `packages/forest/src/view/evidence/code-rows`) as the desktop app opens it, at 1440 x 960, with five running sessions in the stand-in bridge. Each session holds a capability (so it tints a coast and faintly fills a territory) and its window opens three accepted decisions and one surveyed file that no other window opens. `before` is `main` at bef6dd7b; `after` is this branch.

| | none selected: before | none selected: after | one selected: before | one selected: after |
|---|---|---|---|---|
| reading-path lines | 15, in 5 colours | 0 | 3, in its colour | 3, in its colour |
| notes lit in a session's colour | 15 | 0 | 3 (its window) | 3 (its window) |
| file circles lit | 5 | 0 | 1 | 1 |
| windows asked of the host | 5 | 0 | | |
| coast tints / claimed fills | 5 / 5 | 5 / 5 | 5 / 5 | 5 / 5 |
| rows listed | 5 | 5 | 5 | 5 |

- [Before, none selected: every session's traversal in its colour](before-none-selected.png)
- [After, none selected: knowledge points unlit, no lines, no lit file circles; coasts and claimed fills as before](after-none-selected.png)
- [Before, "Survey the agent link" selected](before-one-selected.png)
- [After, the same session selected: unchanged](after-one-selected.png)
- [What each run read from the scene](measurements-before.json), [and after](measurements-after.json)

Counted from the scene's userData: `knowledge-trail:` lines, `knowledge-point:` dots with `lit` or `window` state, `file-lit:` fills, `coast-tint:` bands and `territory:` meshes with `claimedBy`. The captures in `../five-latest-sessions`, `../window-all-sessions`, `../window-files-all-sessions`, `../all-sessions` and `../shared-note` record the no-selection view this decision removes.

```sh
node --import tsx packages/knowledge-core/evidence/traversal-when-selected/build.mjs <main checkout> before
node --import tsx packages/knowledge-core/evidence/traversal-when-selected/build.mjs . after
node --import tsx packages/knowledge-core/evidence/traversal-when-selected/capture.mjs before --retake
node --import tsx packages/knowledge-core/evidence/traversal-when-selected/capture.mjs after --retake
```
