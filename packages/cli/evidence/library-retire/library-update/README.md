# Library update: terminal retirement

This patch is landing evidence for the supervisor to apply to the authoritative
0.3 library on the laptop. This lane did not access either live store. The old
fields come from the read-only snapshot `2026-09-27T14-03-38-576Z.json`; compare
them with current fields and preserve any later changes when applying the patch.

[changes.patch](changes.patch) names the existing record and field in each path.
The `ADD contract under capability_ab59a8461dd7` path requests a new contract;
every other entry edits its existing record. No decision or question record is
created by this lane.

Supervisor checklist, after the PR merges:

- [ ] In **The command line** (`story_f9fb5136c28f`), add contract **3.8** under
  **Library** (`capability_ab59a8461dd7`): general retirement with reason and
  writer, preserving the library's refusals.
- [ ] Update Library's description and its as-built text
  (`definition_4c73f57af8cc/meaning`).
- [ ] Under **Questions** (`capability_bfc6fa737f09`), amend contract **5.4**
  (`contract_1f75b32384c9/title`) and as-built text
  (`definition_13ecbb41920a/meaning`): other record kinds are refused without
  writing, with a direction to `library retire`; held questions remain refused.
- [ ] Clarify the historical omission paragraph
  (`definition_5275707092fe/meaning`): the old `library artifact retire` spelling
  remains absent, while the general retirement operation is now available.
- [ ] Read back all changed fields and the new contract, preserving IDs, links,
  sibling contracts, and any edits made since the snapshot.
- [ ] Close `increment_6125b244ae03` on `arc_a365d0653ac9` with the merged PR and
  confirm the supervisor-held claim has ended. The lane does not close it.

Tests exercise the built CLI against throwaway projects. Contract 3.8 checks a
contract and an artifact, the required reason, and person/session writers.
Contract 5.4 checks wrong-kind refusal without writes, the library's held-question
refusal through both commands, and question retirement once its hold is removed.
Observed failures are in [red.txt](../red.txt).

The librarian pass reconciled the story text above. No decision or agent-guidance
curation was needed, and no additional durable lesson, friction item, or owner
redirection arose.
