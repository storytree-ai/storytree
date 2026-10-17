# Supervisor checklist

- [ ] Confirm the foundation, listing, stopping, closing and #158 doors hand-offs were applied. `changes.patch` starts from those prepared descriptions, not a live-store read; compare them with the live records before applying.
- [ ] Apply the four description diffs: capability_a3e608293417 (launch coverage boundary), capability_611029207d9a (listing/delivery/identity), capability_f3a301d328cd (stop doors), capability_d401990d9a5e (clear doors).
- [ ] Retain the supervisor-directed offline CLI identity as-built paragraph on capability 3. Hook-corrected named subagent identity applies to MCP calls with an exact call id; no shell hook identity is guessed.
- [ ] Review installed-action contracts 3.5/3.6 and clear contracts against this PR's tests and native CI evidence. No contract IDs or new contracts were invented: these doors implement the existing promises.
- [ ] Run the separate laptop installed acceptance, including Windows arm64 when available. Linux payload assembly and Windows x64 CI are distinct evidence; neither proves arm64 execution.
- [ ] After the PR merges, close increment_8d245936227b on arc_197b9208adfc and release the supervisor-held claim.

The supplied 2026-09-27T14-03-38-576Z snapshot predates the own story (no story_9abd84ab493f / capability_611029207d9a). Record IDs and old fields are derived from the committed hand-offs above. No live store, decision, question, claim or closure was written by this lane. Curation found no decision or durable-guidance change to make.
