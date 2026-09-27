# Decision-number repair evidence

Owner authorization: settled `oq-0-3-decision-numbers-refused`, A, 2026-09-27.
Increment: `0-3-library-decision-numbers`; arc: `storytree-0-3-own-library-arc`.

- Red commit: `9065a25` (`red(decision-numbers): pin repair and explicit numbering rules`), pushed.
  [Saved output](red.txt): 21 tests, 13 passing, 8 failing for the missing behavior.
  Command: `flock /tmp/storytree-heavy.lock pnpm test -- packages/library/src/knowledge/decision-log.test.ts packages/cli/src/decisions.test.ts`.
- Final checks: `flock /tmp/storytree-heavy.lock pnpm typecheck` and
  `flock /tmp/storytree-heavy.lock pnpm test`. The scope is full because the library is used by
  the test harness and scripts. The PR carries the final outcome and test-ratio all row.
- [Dry run](dry-run.txt): 29 ready, 0 refused. [Old → new table](number-table.md).
- [Restored-copy result](snapshot-verification.txt): every repair ran through the real CLI,
  with 29 new history events. All previous history and all 53 founding books are unchanged.
  Existing decision IDs, text, links and other read fields survive. Legacy decisions receive
  the normal schema upgrade to accepted status when written; their original history remains.
  Reruns and automatic numbering in storytree are refused; explicit `adr new --number 660`
  succeeds on the throwaway copy.

The copy was restored with:

```sh
storytree_repair_home=$(mktemp -d /tmp/storytree-decision-repair.XXXXXX)
STORYTREE_HOME="$storytree_repair_home" node --import tsx scripts/restore-library.mjs \
  ~/storytree-lanes/snapshots/2026-09-27T12-40-59-713Z.json
```

The verification started that copy's Postgres using `@storytree/local-postgres`, ran
`storytree adr number --dry-run`, and then `storytree adr number <id> <n>` for each proposal,
with `STORYTREE_HOME` pointing only at the temporary home. It compared snapshots and public
history before/after, exercised the refusal and explicit-number cases, and stopped Postgres
in a finally block. No live library or source snapshot was changed.

[Library patch and supervisor checklist](library-update/README.md) are pending live application.
The librarian pass found no blocking issues. No new durable guidance or friction was needed.
The lane leaves the increment open for the supervisor to apply the numbers and close it.
