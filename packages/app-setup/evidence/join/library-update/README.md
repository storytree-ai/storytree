# Pending library update — installed setup join

After merge, the laptop supervisor applies [changes.patch](changes.patch) to **The app
setup** (`story_b91056a06337`). Paths address library fields, not repository files.

The supplied September 27 snapshot predates this story. The base descriptions and record
IDs therefore come from the landed capability-2 patch in PR #149 and capability-1 patch
in PR #150. Read the current records before applying, preserve sibling additions and
remove only the obsolete statement that the installed caller remains unbuilt.

- [ ] Capability 1 (`capability_790ee7f22546`): append the join's as-built paragraph to `description`.
- [ ] Capability 2 (`capability_01dc27eec57f`): replace the pending-caller sentence and append the implementation and evidence paragraphs in `description`.
- [ ] Preserve all contract IDs, titles, health and shelf links. Existing contracts 2.1–2.6 cover this join; no new contract or decision is proposed.
- [ ] Keep the later Windows/real-harness acceptance limits explicit; tools connected does not mean hooks verified.
- [ ] Read back both edited descriptions and verify all other fields and links remain.
- [ ] Close `increment_1bb076ad0f30` after the PR merges, using `/tmp/setup-join-close.md`; the supervisor holds the claim and owns closure.

No plan, claim, decision, question or live library record was read or written by the lane.
No decision-log curation was needed.
