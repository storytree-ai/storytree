# Stalled database handshakes

A Postgres endpoint that accepted TCP but never completed authentication left the
library opening indefinitely. MCP's activity-log timeout did not bound that library
open; the CLI used the same unbounded library pools.

Local library pools now use a 3,000 ms connection timeout by default, including the
admin pool and each project's pool. MCP supplies its existing 3,000 ms limit to
both the library and activity log. The driver destroys timed-out connections;
failed openings are forgotten. Both MCP openings settle before the answer so the
next call can immediately retry. The reply says the database is not reachable and
tells the caller to check that the app is responding, then retry.

This bounds fresh connection handshakes. It does not impose a timeout on SQL already
running on an established connection. Cloud SQL keeps its existing 20-second bound.
No CLI source or library write-path code changed.

## Red and green

- Red commit: `03aa8df` (`red.txt`): both new tests failed at the silent server's
  10-second cleanup disconnect: MCP 10,006 ms; library 10,008 ms.
- Green implementation: `8d9c3e0` (`green.txt`): MCP 3,007 ms; library admin 3,004 ms
  and project 3,003 ms. Both paths recovered after the same endpoint began answering.
- The wall-clock tests allow 1 second for scheduling beyond the 3-second timer.
  They retain a 10-second cleanup disconnect so regressions fail instead of hanging.
- `cli.txt`: the actual bundled command exited on its own, code 1, in 3,129 ms
  including Node startup, with the actionable answer. After recovery at the same
  address, the next command succeeded in 192 ms.

Run the focused tests:

```sh
flock /tmp/storytree-heavy.lock pnpm test -- --test-name-pattern='stalled.*handshake' packages/library/src/project/cloud-connection.test.ts packages/agent-link/src/tools/agent-tools.test.ts
```

Run the CLI acceptance (builds into a throwaway directory, starts isolated Postgres,
uses a small silent TCP server, then forwards that same address to Postgres):

```sh
flock /tmp/storytree-heavy.lock node --import tsx packages/agent-link/evidence/stalled-db/cli-check.mjs
```

The supervisor's library patch and application checklist are in `library-update/`.
