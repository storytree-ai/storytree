# Pending library update — the capability tree's own space

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The forest**
(`story_deee4230348c`), capability **4 · Drill-down** (`capability_f0ffead428df`). It is an
old → new text patch against the supplied `2026-09-28T13-42-19-911Z.json` snapshot, read from a
throwaway restored home. The lane wrote to neither live store. Record paths name library fields,
not repository files; read the current records first and keep IDs, other fields, shelf links and
anything changed since the snapshot.

- [ ] Replace `capability_f0ffead428df` — `description`.
- [ ] Replace `contract_0968031ceff0` — `title` (4.8: box → card, diagram → tree).
- [ ] Add the two `ADD contract under capability_f0ffead428df` entries (4.9, 4.10), held by
      `drill-down/tree-layout.test.ts` and `view/story-panel.test.ts`.
- [ ] Apply the "As built" hunk to `definition_d706c4dfe91c` — `meaning`.
- [ ] Apply the "Leaves out" hunk to `definition_4e3a12837741` — `meaning` (0.2's pannable sub-map
      is no longer left out, by ADR-0743).
- [ ] Read back every edited record and the new contracts; verify shelf entries remain.
- [ ] Take the four captures in `packages/forest/evidence/captree/` to the owner; the lane has not
      accepted the look.
- [ ] Close `increment_9ca333f00405` on `arc_48a2bfc7fdbe` after merge, using `/tmp/captree-close.md`.

No decision or question is created by this patch (ADR-0743 is already recorded). The pan and zoom
themselves are proved by the Electron captures, not by a unit test: they are pointer wiring over
the laid-out tree, which is where the tested logic lives.
