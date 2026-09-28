# Supervisor follow-up: agent-link connection-reset recovery on macOS

The first macOS run of this PR failed in an existing agent-link test outside this lane's fence:
[job 108882929869](https://github.com/storytree-ai/storytree/actions/runs/36408532506/job/108882929869).

`packages/agent-link/src/activity/activity-log.test.ts:165` deliberately resets its first TCP
connection. This run received `Error: write EPIPE` from `pg-pool`, through `applySchema`
and `openAtUrl` in `activity-log.ts`. Its connection-reset retry currently recognizes only
`ECONNRESET`. All app and desktop tests passed, including the new teardown regression;
the local gate and Linux also passed. No test was weakened or skipped.

This warrants a separate agent-link increment: investigate and pin whether the deliberately
reset first connection can surface as `EPIPE` and needs the same retry. The smoke-teardown
file fence excludes agent-link, so this lane leaves that code alone. The supervisor owns
filing and dispatching this follow-up; no live-store record or claim was made here.

The final lane report records the fresh CI result after synchronizing with main.
