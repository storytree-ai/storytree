# Pending library update — the capability tree's own space inside the panel

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The forest**
(`story_deee4230348c`), capability **4 · Drill-down** (`capability_f0ffead428df`). It is an
old → new text patch whose "old" text is #204's applied text (its
[changes.patch](../../captree/library-update/changes.patch) new side), not the
`2026-09-28T13-42-19-911Z.json` snapshot's. The lane wrote to neither live store. Record paths name
library fields, not repository files; hunk line numbers are approximate: match on the text. Read
the current records first and keep IDs, other fields, shelf links and anything changed since.

- [ ] Replace `capability_f0ffead428df` — `description`.
- [ ] Add the `ADD contract under capability_f0ffead428df` entry (4.11), held by
      `view/story-panel.test.ts` and `view/pan-zoom.test.ts` (both name it 4.11).
- [ ] Apply the two hunks to `definition_d706c4dfe91c` — `meaning` (the panel's own space and the
      pop-out icon replace the "Open the capability tree" button and the scaled preview; the
      shared `attachPanZoom`).
- [ ] Read back every edited record and the new contract; verify shelf entries remain.
- [ ] Take the three captures in `packages/forest/evidence/captree-inpanel/` to the owner; the lane
      has not accepted the look.
- [ ] Close `increment_2141ce0034da` on `arc_48a2bfc7fdbe` after merge, using `/tmp/captree2-close.md`.

No decision or question is created by this patch (ADR-0743 is already corrected). Contract 4.8's
title needs no change. Contract 4.9 and 4.10 stand as #204 wrote them.
