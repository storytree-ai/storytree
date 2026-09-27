# Own decision numbers — ADR-0662

Increment `increment_a24af47e59dd`, arc `arc_23442c993f25`; the laptop supervisor owns claims,
real-library application and closure. This lane builds the switch and founding-book move only.
The existing `adr number` and Full record `adr renumber` modes remain available.

## What landed

- `adr set-floor --number <n>` previews the one-time project setting; `--apply` stores it.
  It refuses another setting (same, higher or lower), including concurrent attempts. The floor
  lives in project record history and therefore survives restart and snapshot restore.
- Once set, `storytree` allocates above both that floor and the highest number any record ever
  held. Other projects still start at 1. A supplied free `adr new --number <n>` still works.
- `adr renumber --founding-books` previews the live decisions present at switch-on that have
  no Full record line. `--apply` moves them in creation-history order. Completed moves and
  decisions created after switch-on are omitted on retry. Every write rechecks the live record
  and all historical number reservations under the project lock, through the existing repair path.
- Both commands name ADR-0662 in `--help`. Bulk output lists each move/refusal and totals;
  any refusal exits nonzero. A preview reserves nothing; review a fresh preview before applying.

## Red, green and snapshot evidence

Red commit `5aea640` was pushed before running the tests: [red.txt](red.txt) records 32 tests,
24 passed and 8 expected failures for the missing switch/move. The same targeted suite passes
32/32 in [green-targeted.txt](green-targeted.txt). Required typecheck and full `pnpm test` run
under `/tmp/storytree-heavy.lock`; the final scope/results and ratio are in [validation.txt](validation.txt).

The supplied snapshot contains 1,400 records, 7,149 history events and 82 decisions:
**53 founding books and 29 Full record decisions**. With a floor of 662:

- [Floor preview](floor-dry-run.txt), [floor apply](floor-apply.txt).
- [Founding preview](founding-dry-run.txt): 53 ready, 0 refused, no writes.
- [Founding apply](founding-apply.txt): 53 changed to 663–715, 0 refused.
- [Next decision](new-decision.txt): automatic ADR-0716.
- [Repeat floor](floor-repeat.txt), [lower floor](floor-lower.txt): refused without writes.
- [Repeat founding apply](founding-repeat.txt): 0 changed, 0 refused.
- [Preservation/restart/restore checks](snapshot-verification.txt): all original history and
  other fields survive; Full record decisions and unrelated records are unchanged. Legacy
  decisions receive the existing accepted-status schema upgrade when written.

Reproduce from the repository root (requires the supplied read-only snapshot):

```sh
flock /tmp/storytree-heavy.lock node --import tsx \
  packages/library/evidence/own-numbers/verify-snapshot.mjs \
  ~/storytree-lanes/snapshots/2026-09-27T14-03-38-576Z.json
```

[The proof script](verify-snapshot.mjs) creates its own temporary `STORYTREE_HOME`, executes
`node --import tsx scripts/restore-library.mjs <snapshot> --project storytree`, then runs the
real CLI against that copy. It stops its server and removes its home in `finally`. The source
snapshot is read only. No real library, plan, claim, question or decision record was written.

## Laptop commands, after merge

The floor **must be 0.2's actual final number at switch-on**, at least 662, including any decision
allocated since ADR-0662. Read the unfiltered 0.2 log in its existing bookkeeping checkout:

```sh
pnpm storytree adr list
```

Set the shell variable `Final02Number` to the highest decision number in that log. The value
662 in this evidence is a snapshot experiment, not an instruction to use it for the live switch.
Then, in the merged **0.3 storytree checkout**, with its app/library running, execute in order
(PowerShell syntax; review each dry-run output before its apply):

```powershell
pnpm storytree adr set-floor --number $Final02Number --dry-run
pnpm storytree adr set-floor --number $Final02Number --apply
pnpm storytree adr renumber --founding-books --dry-run
pnpm storytree adr renumber --founding-books --apply
pnpm storytree adr renumber --founding-books --dry-run
pnpm storytree adr list
```

Expect 53 founding moves if the live founding set still matches the snapshot; the last preview
should show 0 ready and 0 refused. If any row refuses, the command exits nonzero and independent
rows may already have succeeded: inspect the reason, preview again, and apply remaining rows
only after review. Never reset the floor. The next genuine `adr new` can omit `--number`.
The deliberately disposable `adr new` in the snapshot proof is not a live-library instruction.

Apply the [field patch and checklist](library-update/README.md), preserving live sibling edits,
and read the fields back. The supervisor then closes the increment with this PR. Retiring the
one-time verbs is a later landing, as directed.
