# Library update for the laptop supervisor

Pending application after merge. These are proposed field edits to existing library records,
not a second library or import source. The owner already chose A in
`oq-0-3-decision-numbers-refused`: “Go with A, i don't want collisions.”

The [patch](changes.patch) shows exact old → new text against the read-only snapshot
`2026-09-27T12-40-59-713Z.json`. Paths are logical targets, not repo files. Read each live field
before applying these changes, preserve sibling text and existing IDs, links and shelves, then
read back. Do not replace a whole live field from the snapshot if it has changed meanwhile.

- [ ] Library story `story_754e87e7d531`, capability 13 `capability_78d6e026f902`: apply the
  description change. Update contract 13.1 `contract_104cac07c8a3` to scope automatic numbering
  to other projects. Add contracts 13.5–13.6, using the next free numbers if necessary.
  [Completed target text](library-capability-13.md).
- [ ] Command-line story `story_f9fb5136c28f`, capability 6 `capability_562b2527ebca`: apply the
  description change. Update contract 6.1 `contract_e43e6620c138` to scope automatic numbering
  to projects that allow it. Add contracts 6.6–6.7, using the next free numbers if necessary.
  [Completed target text](command-line-capability-6.md).
- [ ] Apply the in-place N1 clarification to the ADR-0640 short form
  `decision_9ec9a13fbeb4` from the patch. It records the settled answer's narrow exception;
  it does not create a new decision or change the Full record line. If the supervisor records
  that answer in a new full ADR, obtain its number explicitly and cross-reference it here.
- [ ] Read back changed fields and new contracts; confirm sibling text, IDs, links and shelves.
- [ ] Against the owner's library after the merged build is running, run
  `storytree adr number --dry-run`. Compare all 29 proposals with the PR table; investigate
  any refusal or unexpected row before writing. The preview reserves nothing.
- [ ] Run `storytree adr number <decision-id> <n>` for each verified proposal. Use IDs from
  the table because their current number labels change. Read back each number and its history.
  The real verb rechecks eligibility and historical collisions inside the write.
- [ ] Confirm all 29 records retain identity, text, links and other fields; all 53 founding
  books remain untouched. They have no Full record line, and this verb cannot renumber them.
- [ ] Close `0-3-library-decision-numbers` only after applying the live numbers and these
  library updates, with the merged PR and this line in the close note:
  **The 53 founding books are untouched; their renumbering remains for cutover.**

The only project mechanism is the existing project name `storytree`, passed from project
opening to the knowledge layer. There is no new configuration or cutover switch. Automatic
allocation remains refused there until subsequent authorized work changes that policy.

This lane writes no live library records and does not close the increment. Its restored-copy
verification checks 29 successful CLI repairs, preserved history, unchanged founding books,
refused reruns and automatic numbering, and explicit `adr new --number` acceptance.
