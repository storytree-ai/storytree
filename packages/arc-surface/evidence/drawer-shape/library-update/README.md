# Pending library update — ADR-0660 drawer shape

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The arc surface** (`story_7722ddb5461e`). This is an old → new text patch against the supplied 2026-09-27T12:40:59.817Z snapshot, not an import or a replacement library. Record paths in the patch identify fields, not repository files. Read current records before applying; preserve IDs, other fields, sibling text and shelf links. No new decision is needed.

Each replacement is scoped below; add only the final persistence contract.

- [ ] Capability story: replace `story_7722ddb5461e` — `description`.
- [ ] Capability 3: replace `capability_d077e76e50d7` — `description`.
- [ ] Capability 4: replace `capability_fa8ea39882fe` — `description`.
- [ ] Capability 5: replace `capability_ee7d649bbc20` — `description`.
- [ ] Capability 3: replace `contract_f64050164f89` — `title`.
- [ ] Capability 3: replace `contract_837ebb83e46d` — `title`.
- [ ] Capability 3: replace `contract_539e1843ff1c` — `title`.
- [ ] Capability 3: replace `contract_4d0a071b920f` — `title`.
- [ ] Capability 4: replace `contract_87e90d46c55b` — `title`.
- [ ] Capability 4: replace `contract_dc6a9d61ef84` — `title`.
- [ ] Capability 5: replace `contract_b2ab71987bbd` — `title`.
- [ ] Capability 5: replace `contract_e0552cf341f0` — `title`.
- [ ] Capability 3: replace `definition_d40b09a10211` — `meaning`.
- [ ] Capability 3: replace `definition_d7bec65ac642` — `meaning`.
- [ ] Capability 4: replace `definition_e45f1bfe6988` — `meaning`.
- [ ] Capability 5: replace `definition_42906594a25b` — `meaning`.
- [ ] Capability story: replace `definition_eb3bbc4479b5` — `meaning`.
- [ ] Capability story: replace `definition_8799636c1e9d` — `meaning`.
- [ ] Capability story: replace `definition_cebb27e98962` — `meaning`.
- [ ] Capability 3: add `ADD contract under capability_d077e76e50d7` — `title`.

- [ ] Read back every edited record and the new contract; verify existing shelf entries remain.
- [ ] Close increment `increment_f4fa96dbd3e7` after merge, using `/tmp/arc-drawer-close.md`.

The page census now records the compact drawing honestly: a collapsed queue is not a drawn arc row; expanded chips expose names, counts and full hover readings, while only root lanes draw increment bars. This follows ADR-0660’s chip shape. The four state colours, waits, agents and read APIs did not change.

No decision-log or agent-role curation was required. This checklist carries the story and contract text that the lane cannot write to the laptop’s live library.
