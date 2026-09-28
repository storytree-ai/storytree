# Pending library update — capability cards' words, the proposed flag, the fitted opening view (ADR-0744)

The laptop supervisor applies [changes.patch](changes.patch) after merge, and switches proposed off
per [switch-off.txt](switch-off.txt). The patch is old → new text whose "old" side is the read-only
snapshot `2026-09-28T21-35-29-644Z.json`. The lane wrote to neither live store and wrote no decision
or question. Record paths name library fields, not repository files; match hunks on their text.
Read the current records first and keep ids, other fields, shelf links and anything changed since.

The forest — `story_deee4230348c`, capability 4 · Drill-down (`capability_f0ffead428df`):
- [ ] Replace `capability_f0ffead428df` — `description`.
- [ ] Replace the titles of contracts 4.2 (`contract_543b7b61443b`), 4.6 (`contract_c3568825a0bf`),
      4.8 (`contract_0968031ceff0`), 4.10 (`contract_1bf0d07cb453`) and 4.11 (`contract_6514cef07b0b`).
      Held by `drill-down/drill-down.test.ts`, `view/story-panel.test.ts` and `view/pan-zoom.test.ts`.
- [ ] Apply the four hunks to `definition_d706c4dfe91c` — `meaning` (the "as built" text).

The library — `story_754e87e7d531`:
- [ ] 4 · Work model (`capability_dd486ffa5b02`): append the sentence to `description`; add contract
      4.6 (held by `work/work-model.test.ts`, both backends).
- [ ] 5 · Health record (`capability_f27ac2abb10b`): append the sentence to `description`; add
      contract 5.6 (held by `health/health-record.test.ts`, both backends and the pure function).

The command line — `story_f9fb5136c28f`:
- [ ] 10 · Plan view (`capability_f874f7de8110`): append the sentence to `description`'s first
      paragraph; add contract 10.3 (held by `packages/cli/src/tree.test.ts`).

The agent link — `story_609c3b171b3f`:
- [ ] 6 · Agent tools (`capability_11fe600afeda`): the first paragraph of `description` names
      `mark_built`; add contract 6.23 (held by `tools/agent-tools.test.ts`). Note that the snapshot
      already has two contracts numbered 6.22 (`contract_368332beed91`, `contract_cabdc3aeb3ce`).

After:
- [ ] Read back every edited record and each new contract; verify shelf entries remain.
- [ ] Switch proposed off for the capabilities in `switch-off.txt` lists A and B, and for those in
      list C the live arc surface shows landed (`pnpm storytree capability built <id>`, from the
      merged main).
- [ ] Take the four pictures in `packages/forest/evidence/cardwords/` to the owner; the lane has not
      accepted the look.
- [ ] Close `increment_66e436b80cfa` on `arc_48a2bfc7fdbe`, using `/tmp/cardwords-close.md`.
