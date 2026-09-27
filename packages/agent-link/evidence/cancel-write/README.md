# Cancellation while waiting for a write

Increment `increment_19775abeb4b1`, arc `arc_cfc7db517fae`; chaos drill B2.

- [red.txt](red.txt): commit `c69fabe` reproduces the MCP bug. The test observes the edit
  waiting on PostgreSQL's advisory lock, sends `notifications/cancelled`, releases the lock,
  waits for a subsequent write to finish, and finds the unwanted title committed.
- [red-transactions.txt](red-transactions.txt): commit `94256ab` shows both transaction
  backends accepting an already-cancelled write. The final assertions live in
  `packages/library/src/transactions/cancellation.test.ts`: `scripts/own-health.test.mjs:168`
  pins the original shared suite's exact contract list, so adding 2.11 there failed that
  scripts assertion despite all package tests passing. A dedicated test keeps both backend
  proofs within this lane's file fence without changing the health checker or its test.
- [green.txt](green.txt): the same tests pass with the signal threaded through writer options.
  The transaction test also cancels from validation, after admission, and proves that the
  write and its attributed history still commit. Save, edit and retire reject before admission.
- [library-update](library-update/README.md): field patch and supervisor checklist.

Reproduce the focused proof with the existing database runner:

```sh
flock /tmp/storytree-heavy.lock pnpm test -- --test-name-pattern='6.20|2.11' packages/agent-link/src/tools/agent-tools.test.ts packages/library/src/transactions/cancellation.test.ts
```

The production change stays in the MCP handler and library write path. SchemaRecords and
health are the verbs forwarding options to transactions; no project connection, numbering,
CLI, app or script code changes are needed. Cancellation is checked when a blocked lock
wait finishes, before any record work; it does not terminate the SQL wait itself.

## Supervisor residue: cancellation during claim activation

[claim-gap-red.txt](claim-gap-red.txt) confirms a related gap outside the lane's file fence:
`packages/agent-link/src/claims/claims.ts` reconstructs actor-only options when it calls
`advanceIncrement`. A cancelled MCP `claim` waiting for that library write still changes the
increment from `proposal` to `active`. `make_workspace` and `attach_workspace` use the same
claim path; they were identified by code review, not separately exercised by this probe.

The direct fix needs `ClaimContext` to carry the caller's writer options and use them for
`advanceIncrement`; `tools/claim-tools.ts` must pass those options. The reviewable patch is
`/tmp/cancel-write-claims-extension.patch`, and the probe is `/tmp/cancel-write-claim.probe.ts`.
This lane requested a fence extension but did not receive approval, so neither is applied.
The new tool contract is therefore specifically about `edit_plan`; the library contract
applies to writes supplied with a signal. Do not describe all MCP tools as cancellation-safe.

Supervisor action: retain this claim-activation gap as residue on the owning arc and schedule
the claim-path repair with authority to edit `claims/claims.ts`. The isolated probe can be
copied back to `packages/agent-link/src/tools/cancel-claim.probe.ts` and run with the existing
database runner. No separate cleanup session is requested for the pinned health-scanner test:
replace that assertion's real-suite fixture when its owning scripts are next changed.
