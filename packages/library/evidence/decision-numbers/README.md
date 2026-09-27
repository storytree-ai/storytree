# Bulk N1 move — adr-numbers lane

Increment `increment_4c869f0f71a1`, arc `arc_23442c993f25` in the laptop's 0.3 library.
This landing extends the single-record repair already merged in PR #130.

- Red commit: `e94dda8`, pushed before the red run; [red.txt](red.txt) captures the five expected
  failures among 26 tests (missing bulk API / CLI and project-wide collision check).
- Library: `numberDecisionsFromFullRecord` previews by default; `apply: true` applies eligible
  rows and reports refusals. Already-matching targets disappear from previews.
- CLI: `adr renumber --from-full-record --dry-run`, then `--apply` after review;
  `adr renumber <decision> --number <n>` for one record. The existing `adr number` remains available.
- The same history ledger and atomic write lock now check repair targets across every record type,
  including history from retired records. `editNote` still refuses number changes.
- [Bulk dry run](bulk-dry-run.txt), [bulk apply](bulk-apply.txt),
  [after counts and preservation checks](bulk-snapshot-verification.txt),
  [after preview](bulk-after-dry-run.txt), and [repeat apply](bulk-repeat-apply.txt).
  The snapshot copy has 29 eligible targets, 0 refusals; 53 founding decisions remain unchanged.
- Required validation: typecheck and the full test scope under `/tmp/storytree-heavy.lock`.
  See the PR for final checks and the `test-ratio` all row.
- Founding-books mode is deferred: authorizing decisions without Full record lines is a separate
  path from the existing one-time repair. This lane leaves all 53 untouched.
- [Current supervisor patch/checklist](library-update/README.md). No live library, plan, question
  or decision record was edited. The supervisor owns application and increment closure.

The earlier evidence below is preserved as PR #130 history; its per-record execution and
old increment names do not describe this lane's bulk command or current bookkeeping.

---

# Decision-number repair evidence

Owner authorization: settled `oq-0-3-decision-numbers-refused`, A, 2026-09-27.
Increment: `0-3-library-decision-numbers`; arc: `storytree-0-3-own-library-arc`.

- Red commit: `9065a25` (`red(decision-numbers): pin repair and explicit numbering rules`), pushed.
  [Saved output](red-pr130.txt): 21 tests, 13 passing, 8 failing for the missing behavior.
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
