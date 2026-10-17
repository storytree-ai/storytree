# Finish with an honest inventory

Capability 5 of `story_9abd84ab493f`, increment `increment_5df7e7b316ab` on
`arc_197b9208adfc`. Library functions only; the supervisor owns the live plan and closure.

## Front-door handoff

Available from both `@storytree/own` and `@storytree/own/closing`:

```ts
const cleared = await clearOwned({ owner, home, knownGaps });
// Report removed, retained, failed and gaps independently; failed is never a removal count.
const reading = await readClosing({ home, owner, knownGaps, shared });
const text = renderClosing(reading);
```

- `clearOwned(options, dependencies?)` requires the resolved caller owner. `home` is an optional
  ledger-directory override, as in the foundation. Only that session/harness's records can be
  deleted; a named subagent is limited to its own records. Delegated sessions' records remain.
  Every registered descendant must also be confirmed gone, even when owned by another session.
- Clear returns `machine`, `owner`, `removed` (run UUIDs), `retained` (run/reason/blockedBy),
  `failed` (run/path/reason), `gaps` and `coverage`. It does not signal processes, delete request
  evidence or gap records, release claims, or change a session or increment.
- A read/registration/observation gap conservatively blocks cleanup because an unreadable child
  cannot be ruled out. Gaps without readable ownership are never attributed to the caller.
  Records and child membership are reread after probing, before each unlink. Added, changed,
  disappearing or reparented records retain the affected parent. An unlink error is a failure,
  including a concurrent deletion; only a successful unlink enters `removed`.
- `readClosing(options?)` returns `{ status, inventory }`, with status `empty`, `remaining` or
  `incomplete`. It reuses `listRuns` with **all-session** scope, regardless of the optional caller.
  Live rows mean remaining work; unknown rows or missing evidence mean incomplete. Gone rows may
  remain on disk without blocking an empty reading. The exact inspector lifetime is excluded by
  the listing API. Shared work stays separately visible and is never automatically stopped.
- `renderClosing(reading)` reports the verdict, then the existing inventory rendering. The empty
  verdict says “no tracked session work remains on this machine”, accompanied by launch coverage
  and an explicit limit on remote machines. Missing evidence remains separate from known live rows.
- Carry a failed launch's gap in `knownGaps` when `gapRecorded` was false: a later disk read cannot
  recover that evidence. Both clear and closing accept it. Persisted gaps are read automatically.
  The front door must preserve incomplete results; a clear receipt is not a closing reading.

These are point-in-time observations without an atomic launch interlock. A new launch after the
reading needs another reading. Only explicitly registered descendants are covered; native process
trees, whole-machine idleness, and remote-machine clearance are not claimed. This lane cannot wire
the CLI/MCP entry points within its file fence; own-doors owns that follow-up.

## Validation and reference

- Pushed red commit: `6438e80` (`red(own-close): pin conservative clear and honest closing inventory`).
  `red.txt` records eight missing-API failures before implementation. Review found an asymmetric
  child-membership comparison; `red-membership.txt` pins a disappearing child before that fix.
- `green.txt` records all nine closing tests passing. They cover contracts 5.1–5.5, including
  cross-session isolation, descendants, unknown/foreign work, corrupt files, failed unlink,
  concurrent membership changes, ended sessions, carried gaps, shared work and bounded wording.
- `gate.txt` records typecheck and scoped tests under `flock /tmp/storytree-heavy.lock`.
  The package suite also exercises the existing native process, launcher, listing and stopping
  paths. The PR's Linux/macOS/Windows checks are required before platform verification is complete.
- `test-ratio.txt` records the report, including its `all` row. This is a report, not a gate.
- 0.2 reference: `packages/drive/src/spawn-registry.ts:381` clears only confirmed leaked records;
  its `:256` removal swallows errors, and `packages/cli/src/own.ts:342` always reports success.
  This implementation preserves conservative retention and reports removal failures explicitly,
  as 5.2 requires. The reference registry persisted from August 14 (`faead00e`) through at least
  August 22 (`005969a8`); no existing product behavior was dropped as a short-lived experiment.

The supplied September 27 snapshot has 1,400 records and predates this story. No contract IDs
were recoverable. `library-update/changes.patch` appends as-built text using the capability ID and
approved description in the brief; its checklist maps existing contracts without duplicating them.
No live plan read/write, decision, role or memory edit was needed. No new friction or owner
redirection was recorded. The evidence and patch are the durable handoff; decision-log curation
had nothing to do.
