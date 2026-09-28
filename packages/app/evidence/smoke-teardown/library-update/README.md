# Pending library update — smoke teardown

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The app**
(`story_a93c6fb1a257`), capability **1 · Lifecycle** (`capability_076723ee3066`).
This patch uses the supplied `2026-09-28T09-15-09-235Z.json` snapshot, restored into a
throwaway home and inspected with the 0.3 CLI from a scratch project directory.
Record paths identify library fields, not repository files. Read the current records first;
preserve IDs, links, other fields and changes made since that snapshot.

- [ ] Extend `contract_4f42289786f0` — `title` (1.7).
- [ ] Append the teardown “As built” text to `definition_1be250107f9f` — `meaning`.
- [ ] Append the regression and native smoke proof to `definition_b5284f2d8f14` — `meaning`.
- [ ] Read back all three edited records and verify existing links remain.
- [ ] Close `increment_8202fb90e611` on `arc_2ae8d2ebe1f6` after merge, using
  `/tmp/smoke-teardown-close.md`; the supervisor holds the claim.

No new contract is needed. The surface census contract (3.3) is unchanged. No live store,
claim, decision or question was written by this lane. No decision-log or agent-role curation
was needed. This is a lifecycle change with no appearance acceptance or captures required.
