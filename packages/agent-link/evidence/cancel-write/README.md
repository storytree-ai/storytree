# Cancellation while waiting for a write

Increment `increment_19775abeb4b1`, arc `arc_cfc7db517fae`; chaos drill B2.

- [red.txt](red.txt): commit `c69fabe` reproduces the MCP bug. The test observes the edit
  waiting on PostgreSQL's advisory lock, sends `notifications/cancelled`, releases the lock,
  waits for a subsequent write to finish, and finds the unwanted title committed.
- [red-transactions.txt](red-transactions.txt): commit `94256ab` shows both transaction
  backends accepting an already-cancelled write.
- [green.txt](green.txt): the same tests pass with the signal threaded through writer options.
  The transaction test also cancels from validation, after admission, and proves that the
  write and its attributed history still commit. Save, edit and retire reject before admission.
- [library-update](library-update/README.md): field patch and supervisor checklist.

Reproduce the focused proof with the existing database runner:

```sh
flock /tmp/storytree-heavy.lock pnpm test -- --test-name-pattern='6.20|2.11' packages/agent-link/src/tools/agent-tools.test.ts packages/library/src/transactions/memory.test.ts packages/library/src/transactions/pg.test.ts
```

The production change stays in the MCP handler and library write path. SchemaRecords and
health are the verbs forwarding options to transactions; no project connection, numbering,
CLI, app or script code changes are needed. Cancellation is checked when a blocked lock
wait finishes, before any record work; it does not terminate the SQL wait itself.
