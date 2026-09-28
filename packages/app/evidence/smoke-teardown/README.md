# Native smoke teardown — increment_8202fb90e611

The app now ends its pages before closing their library. Desktop destroys all windows through
the app story's `background` lifecycle, stopping both project polling and the surface's live
reading. Smoke completion, timeout and startup failure use that same quit path; tray quit and
update restart keep their existing database-stop and relaunch ordering. Window activation
during teardown cannot start another page. Ordinary window closing still leaves the app running.

- [Red regression output](red.txt): the real `followProjects` timer fires while the library is
  closed and the database is still stopping; the test fails on the logged error.
- [Green regression output](green.txt): no read starts after closure, no error is logged, exit 0.
- [Native Electron smoke log](smoke.txt): the restored real project's census passes, followed
  by clean teardown. The log includes stdout and stderr through process exit.
- [Library patch and supervisor checklist](library-update/README.md).
- [Unrelated macOS CI failure for the supervisor](ci-followup.md).

The regression lives in `packages/app/src/lifecycle/background.test.ts` under contract 1.7.
It advances the real follower's timer with Node's mock clock to make the shutdown race
deterministic. The other lifecycle tests still cover window closing, repeated quit, a second
launch while stopping, update restart and external quit.

Native verification reuses the gear lane's real-snapshot Electron route and software rendering
flags. No screenshot is committed or submitted for visual acceptance: this unit changes only
shutdown ordering. Run with a working display (a temporary Xvfb on Mint) and Linux Postgres
binaries available to desktop, as described in [the gear evidence](../gear/README.md):

```sh
export STORYTREE_HOME=$(mktemp -d)
flock /tmp/storytree-heavy.lock node --import tsx scripts/restore-library.mjs \
  /home/mickh/storytree-lanes/snapshots/2026-09-28T09-15-09-235Z.json --project storytree
STORYTREE_EMBEDDER=off flock /tmp/storytree-heavy.lock \
  node packages/app/evidence/smoke-teardown/check-smoke.mjs
```

The runner invokes `pnpm desktop:smoke`, retains the complete log and requires both a passing
census and no closed-library or IPC-handler error. Electron's routine platform diagnostics,
if present, remain visible. The command's incidental screenshot stays in the throwaway home.

Checks: `pnpm typecheck`, scoped `pnpm test` and `pnpm gate`, under `/tmp/storytree-heavy.lock`.
The initial scope includes desktop, app and their dependents. After merging current main,
the gate selected the full repository suite because the incoming agent-link changes also
reach the test harness.
Guidance is NOT RUN: no generated role or supporting guidance note changed.
No forest files, live stores, decisions, questions or claims were changed. No guidance
curation or owner redirection arose. The CI follow-up records the evidence for a separate
agent-link fix outside this lane's file fence.
