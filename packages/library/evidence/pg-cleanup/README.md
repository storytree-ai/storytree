# Test Postgres cleanup: 42501

Increment `increment_e925b9e26499`, arc `arc_a365d0653ac9`.

Both Windows attempt-1 logs ([#103](https://github.com/storytree-ai/storytree/actions/runs/36302547501),
[#111](https://github.com/storytree-ai/storytree/actions/runs/36304914968)) report SQLSTATE 42501,
`procarray.c:3903`, routine `TerminateOtherDBBackends`, during the borrowed-creator transaction
suite's cleanup. The caller is the test's unprivileged login, which inherits database ownership
from the creator role. The failed statement is `DROP DATABASE ... WITH (FORCE)`.

The historical logs do not identify the backend. A real autovacuum worker reproduces the exact
message, detail, code and routine on Linux/Postgres 17.10: its `pg_stat_activity.usename` is null,
and the login has neither its privileges nor `pg_signal_backend`. In PostgreSQL's
[implementation](https://github.com/postgres/postgres/blob/REL_17_10/src/backend/storage/ipc/procarray.c),
`TerminateOtherDBBackends` checks those privileges; ordinary `DROP DATABASE` instead uses
`CountOtherDBBackends`, which terminates conflicting autovacuum workers and waits for backends.

The fix keeps FORCE for normal cleanup, including the existing proof that an open project's own
sessions are terminated. Only 42501 from `TerminateOtherDBBackends` falls back once to plain DROP
on the same connection, as the same user. Failure of that DROP still fails cleanup. Ownership,
prepared-transaction and other errors are not retried or hidden.

## Red and green

Red commit: `83d2462` (pushed before running). Command, under the shared heavy-work lock:

```sh
pnpm test -- --test-name-pattern=cleanup packages/library/src/project/cloud-connection.test.ts packages/library/src/testing/pg.test.ts
```

`red.txt`: exit 1, two failures, including the real server's matching 42501. The regression holds
another login's connection until FORCE is refused, then closes it before passing the error back
to cleanup. This makes the transient-backend case deterministic without autovacuum scheduling.
`green.txt`: the same command after the fix, exit 0, all four checks pass.

`autovacuum.txt` records a separate real-worker reproduction before and after the fix. Each run
used its own disposable cluster, stopped and removed in `finally`, configured with
`autovacuum_naptime = 1s`, `autovacuum_vacuum_cost_delay = 100ms`, and
`autovacuum_vacuum_cost_limit = 1`. A LOGIN CREATEDB nonsuperuser created the database and a table
with `autovacuum_vacuum_threshold = 0, autovacuum_vacuum_scale_factor = 0`, inserted 100,000 rows,
deleted them, and disconnected. After an admin connection observed `backend_type = 'autovacuum
worker'` on that database, `dropTestDatabases` ran as its owner. Before the fix it failed with
42501 and a manual plain DROP succeeded; after the fix the helper succeeded itself. This proves
autovacuum can cause the failure on Linux, not which backend was present in the old Windows jobs.
