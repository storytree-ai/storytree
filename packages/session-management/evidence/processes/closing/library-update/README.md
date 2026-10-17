# Supervisor application checklist

The lane did not read, claim, close or write either live plan store. The supplied September 27
snapshot predates this story and contains none of its record IDs. The patch uses the authoritative
`capability_d401990d9a5e` and approved description from the lane brief. Append the as-built text
without replacing any following Foundation paragraph or newer supervisor edits.

- [ ] Apply `changes.patch` to capability 5 of `story_9abd84ab493f` on `arc_197b9208adfc`.
- [ ] Preserve the five approved contracts, 5.1–5.5, unchanged. Their IDs were absent from the
      snapshot and brief; no guessed IDs or duplicate contracts were created.
- [ ] Map 5.1 to caller/harness isolation, delegated descendants and child-membership tests.
- [ ] Map 5.2 to live/unknown/foreign retention, unreadable records and explicit removal failures.
- [ ] Map 5.3 to all-session closing with old sessions and released-claims owners still visible.
- [ ] Map 5.4 to persisted/read gaps and caller-carried failed-persistence evidence. A read of
      disk alone cannot recover a gap whose write failed; carry `knownGaps` at the front door.
- [ ] Map 5.5 to the exact bounded empty verdict, launch coverage, remote limit and shared work.
- [ ] Read the merged PR's Linux/macOS/Windows results before marking platform verification.
- [ ] Hand off CLI/MCP integration to own-doors: exact functions are `clearOwned`, `readClosing`,
      `renderClosing`, exported from both the package root and `/closing`. The clear result
      separates removed, retained, failed and gaps; call `readClosing` for a subsequent verdict.
- [ ] Preserve the registered-descendant coverage and point-in-time limitation. No automatic
      stopping, session/increment closure, claim release or new approval ceremony was added.
- [ ] Close `increment_5df7e7b316ab` after merge using `/tmp/own-close-close.md`, and release the
      supervisor-held claim. This lane starts no successor.

No decision, role or durable-memory changes require decision-log curation. No new friction or
owner redirection was recorded; the API and coverage limits are documented in the evidence README.
