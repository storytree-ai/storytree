# Queued claim cancellation

Increment `increment_c411e66ff4f9`, arc `arc_cfc7db517fae`; follows PR #137.

`claim`, Claude Code `make_workspace`, and Codex `attach_workspace` now carry the request's
abort signal into increment activation. Under the activity lock, a cancelled claim is rejected
before any claim write. Proposed/ready increments activate before the claimed line is appended,
so the library's admission check runs first. No later cancellation check interrupts an admitted
claim or workspace operation.

- [red.txt](red.txt): red commit `3507ef2` (initial tests `12cc096`), five failing queued
  cancellation cases and three passing admitted-operation controls.
- [green.txt](green.txt): the same eight behaviours pass after the implementation.
- [validation.txt](validation.txt): final typecheck, full-suite results and test-ratio after
  merging PR #138 and reinstalling. All 12 units pass; the live-cloud contract is visibly skipped.
- [library-update](library-update/README.md): supervisor-applied field patch and checklist.

Run with the existing real-Postgres runner:

```sh
flock /tmp/storytree-heavy.lock pnpm test -- '--test-name-pattern=6.21|5.15' packages/agent-link/src/tools/agent-tools.test.ts packages/agent-link/src/claims/claims.test.ts
```

The MCP tests observe the actual database lock wait, deliver the real cancellation notice,
and drain the library and claim log transactions before checking records, history, claims,
branches and worktrees. A row lock blocks the admitted controls after they have acquired the
library advisory lock: cancellation then must still complete activation, claiming and workspace
creation/attachment. Direct claim tests hold the activity lock and await each cancelled claim's
completion, covering capabilities and already-active increments which need no activation.

Cancellation drains the SQL wait when its lock is released; it does not interrupt the SQL query.
Tool-called audit lines remain visible. Codex attachment preserves the app-created worktree on
queued cancellation. The implementation changes only claims and tool context forwarding; no
library, CLI, app, script or workspace implementation change is needed.
