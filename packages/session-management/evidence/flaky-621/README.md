# Deterministic cancelled-claim test 6.21

The six existing 6.21 scenarios now use a blocking `pg.Client` and an observing `pg.Client`, and await both clients' `end()` promises before project cleanup. The claim assertions and cancellation behavior are unchanged. No product code or new test harness was added.

## Race and red evidence

The original failure is retained in [ci-failure.txt](ci-failure.txt), from [PR #143's first Linux attempt](https://github.com/storytree-ai/storytree/actions/runs/36354713054/job/108720016375). Its rerun passed.

The test used an unhandled-error `pg.Pool` for its blocker and `pg_stat_activity` polling, then awaited `pool.end()` before `withProject` force-dropped the database. In the installed pg-pool implementation, `_remove` removes the client from `_clients` immediately, and `_pulseQueue` resolves the pool's end callback when that array is empty. The client sockets finish closing later. An idle socket can therefore receive Postgres's administrator-command error from `DROP DATABASE ... WITH (FORCE)` while it is still open. This is a test-owned connection lifetime race.

Red commit `b82a4c3e951f70d750ffdff9fa86ca7b5d57bead` adds an end-event assertion to the existing test. After committing and pushing it, the targeted run failed deterministically with **2 connections still open after `pool.end()`**, recorded in [red.txt](red.txt). This reproduces the missing shutdown guarantee; it does not claim to reproduce the exact original CI scheduling or administrator-command exception.

The green changes the fixture to explicit clients. Unlike the pool promise, each `Client.end()` promise waits for the underlying connection to end. Closing the blocker also releases any outstanding transaction lock. The retained end-event assertion protects the teardown boundary; the connection set counts only clients that actually connected, preserving connection-failure diagnostics.

The product's `claim` awaits activation, the claimed line and the activity commit. Library cancellation is checked before admission, and the admitted write awaits its commit. There is no backend-termination operation on that cancellation path. No product change was justified.

## Repetition and checks

All heavy runs use `flock /tmp/storytree-heavy.lock`. Linux, Node v24.19.0, pnpm 9.15.0.

The loop body is the existing test command (50 separate runner/server starts, not a new harness):

```sh
pnpm test -- --test-name-pattern='6.21 cancelling claim at admitted' packages/agent-link/src/tools/agent-tools.test.ts
```

- Unchanged baseline: **50 runs, 50 passes, 0 failures** ([before-loop.txt](before-loop.txt)). The rare CI failure did not recur naturally on this machine.
- Diagnostic red: **1 run, 0 passes, 1 failure**, with 2 still-open fixture connections ([red.txt](red.txt)).
- First green: **50 runs, 50 passes, 0 failures**. After changing the connection counter to count only successful connections, the loop was repeated over the final code; **50 runs, 50 passes, 0 failures**, recorded in [after-loop.txt](after-loop.txt).
- The six cancellation scenarios pass together ([green-targeted.txt](green-targeted.txt)).
- Required workspace checks and the test-ratio all row are recorded in [validation.txt](validation.txt).

Only 6.21 and its evidence changed. The adjacent 6.20 fixture uses the same pool pattern; no failure was observed there, and changing it is outside this lane's specified 6.21 fence. A separate session is not warranted by this evidence alone; reuse this teardown correction if that fixture is next changed or fails.

## Supervisor handoff

[Library update patch and checklist](library-update/README.md) carry only an as-built capability paragraph; the existing 6.21 contract stays unchanged. No live store or claim was accessed. No decision or question record was written. Decision-log curation had nothing to do, and no durable guidance change or separate friction item was needed: the concrete failure is fixed here and its evidence stays with the change.
