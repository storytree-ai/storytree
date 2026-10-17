# Supervisor library update

The laptop supervisor applies `changes.patch` after merge. This lane did not access a live plan,
claim/release a capability, or write a decision/question. Story and capability IDs are the ones
supplied in the lane brief. The snapshot predates this story, so it cannot supply its contract IDs.

- [ ] Check story `story_9abd84ab493f`, capability 1 `capability_a3e608293417`, and capability 2
      `capability_77a22d55c99e` against the approved tree.
- [ ] Apply the two description additions using the supplied approved opening paragraphs as
      context. Preserve any later prose already present; resolve a context mismatch explicitly.
- [ ] Keep contracts 1.1–1.5 and 2.1–2.5 unchanged; no new contract is required by this foundation.
- [ ] Attach foundation evidence and mark only the implemented foundation behavior as built.
      CLI/MCP wiring, installed harness integration, listing, stop and closing remain later lanes.
- [ ] Keep the coverage qualification: arbitrary unregistered descendants are not attributed.
- [ ] Close `increment_5df7e7b316ab` as landed with this PR after it merges, then release any
      supervisor-held claims remaining under its normal ceremony.

Tests: `packages/own/src/foundation.test.ts` and `packages/own/src/process/index.test.ts`.
API hand-off: `packages/own/README.md`. No decision or agent-role text changed; decision curation
had nothing to do in this lane. These as-built additions are the durable learning to graduate.
