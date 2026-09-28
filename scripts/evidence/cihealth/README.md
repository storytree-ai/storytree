# CI records own health — evidence

ADR-0744 D3-D4: after each change to main, CI runs each of storytree 0.3's own stories' tests and
records every contract's verified health in the library on Cloud SQL.

- [red.txt](red.txt): the four new tests in `scripts/own-health.test.mjs` failing before the build
  (where to record, the unconfigured skip, the CI writer with its commit).
- [green.txt](green.txt): the same file, 20 of 20 passing.
- [ci-first-run.txt](ci-first-run.txt): the workflow's first real run on main, green, the sign-in step skipped, nothing recorded.
- [ci-unconfigured.txt](ci-unconfigured.txt): `pnpm check:own-health` run as CI with no identity
  configured, which is what the first runs on main will do until the owner applies
  [`infra/ci-health`](../../../infra/ci-health/README.md): it names the unset variables, records
  nothing and exits 0.
- [hand-run-restored.txt](hand-run-restored.txt): the hand run end to end after the refactor, on a
  throwaway home holding the 2026-09-28T21:35 snapshot of the library (setting: local, so the app's
  own Postgres path): nine stories run, verified health recorded, exit 0. The one failing contract
  (the command line's 8.5, `packages/cli/src/launcher.test.ts`) fails the same way on this box
  with no custom home, so it is this machine's environment (a "Claude Code: registered" check), not
  this change; CI on main passes it.

Not proven here: the Cloud SQL path end to end. It needs the identity the owner applies, and this
lane may not write the live library. What stands in for it: the path is the library's own
`connect({ cloudSql })`, the one the app and command line use every day on the same instance, and
the target it is handed is pinned by the tests above. The first run after the owner's steps 1-4 is
the proof (the library-update checklist has it).

No pictures: nothing about how the map is drawn changed. Once CI records, a contract's verified
line in the forest's drill-down reads `storytree test run on CI · <time> · 2/2 tests passed, at
commit <sha>`.

Measured on the way (grants): on a local Postgres 17, a user holding SELECT/INSERT/UPDATE on
`record` and `record_event` is refused at `openProject` ("permission denied for schema public";
with CREATE on the schema added, "must be owner of table record"), because every open applies the
project schema. A user granted the owning role `WITH INHERIT FALSE, SET TRUE` opens and writes.
Hence [`infra/ci-health/grants.sql`](../../../infra/ci-health/grants.sql).

[library-update/](library-update/README.md): the story text for the supervisor to apply.

Found after #219 merged: `automerge`'s dispatch step read the pull request as not merged 7 seconds
before GitHub finished the merge (`gh pr merge --auto` returns first; the step ran at 22:19:00, the
merge landed at 22:19:07), so that merge recorded nothing. The step now waits for the merge, up to
two minutes, before dispatching. The proof is the next merge's `Record own health on main` step
starting an Own health run.
