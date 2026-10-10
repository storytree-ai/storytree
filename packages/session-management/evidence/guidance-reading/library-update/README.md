# Pending library update — context guidance

The laptop supervisor applies [changes.patch](changes.patch) after merge to **The agent link** (`story_609c3b171b3f`), capability **9 · Context readings** (`capability_dbef625bdd09`). The source is the supplied `2026-09-28T10-37-34-532Z.json` snapshot, taken at `2026-09-28T10:37:34.817Z`, restored to a throwaway home and read with the 0.3 CLI from a scratch project directory. Neither live store was accessed.

Record paths identify library fields, not repository files. Read the current record first and preserve changes since the snapshot, all IDs, other fields and shelf links.

- [ ] Append the as-built and remaining-integration paragraphs to `capability_dbef625bdd09` — `description`.
- [ ] Keep `contract_871bf83daa39` (9.6) and `contract_e18d4c11929b` (9.7) unchanged: both already match the brief; this patch adds no contracts.
- [ ] Read back the edited capability and verify its shelf entries remain.
- [ ] Record the routing dependency as residue on `arc_748792ea3487`: a malformed settings file prevents a fresh CLI/MCP call from locating its library before context reading. Do not mark the whole of 9.7 proved.
- [ ] Use `/tmp/guidance-reading-close.md` to record the merged work against `increment_79be6b5a62b6`; retain or split out the routing remainder before closing the increment as complete.

The supervisor holds all claims and performs library closure. No decision or question record is created by this patch. No decision-log or agent-role curation was needed; the snapshot reading found no capability 9 as-built/proof definition to amend, so the existing capability description is the edit surface. No owner redirection occurred in this lane.
