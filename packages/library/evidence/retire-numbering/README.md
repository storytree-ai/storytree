# Retire the one-time decision-numbering commands

Increment `increment_c9935aa7f5fd`, arc `arc_23442c993f25`.

The command line now offers `adr new`, `pull`, `push`, `compose`, and `list`. The completed
migration's `adr number`, `adr renumber` (Full record and founding-books modes), and `adr set-floor`
entries are removed. `adr new --number` remains available. Refusal messages no longer recommend
removed commands. No stored number or floor is changed.

The public library methods still have wrappers outside the lane's file fence, so they and their
existing tests remain. The [library patch and checklist](library-update/README.md) record this
limitation and the exact remaining surface for the supervisor.

## Red and green

The pushed red commit `fe69c1f` removes the command entries while retaining their existing tests.
[red.txt](red.txt) records the actual locked run (trailing whitespace normalized) of
`pnpm test -- packages/cli/src/decisions.test.ts`: the six continuing contracts pass and the four
retired-command contracts fail (exit 1). No test of source text, repository structure, or the
absence of a retired command was added.

Green removes those four obsolete tests. The continuing library 13.1 test now explicitly checks
that ordinary edits cannot change **or remove** a number and leave both the record and history
unchanged, on memory and Postgres. The existing floor tests remain green.

Final validation uses `flock /tmp/storytree-heavy.lock pnpm typecheck` and
`flock /tmp/storytree-heavy.lock pnpm test`. Test scope is full because the library supports the
test harness; all 12 units pass. Live Cloud SQL is visibly skipped without credentials.
The exact green SHA and CI result are recorded in the PR and `/tmp/retire-numbering-close.md`.

`pnpm test-ratio` reports (test / implementation code lines / ratio):

```text
  all                       39,370           30,278    1.30
```
