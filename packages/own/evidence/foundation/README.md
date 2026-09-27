# Ownership foundation evidence

Scope: `increment_5df7e7b316ab`, story `story_9abd84ab493f`, capabilities 1 and 2.

- Red commits: `c26a9cc` (package, ownership tests, native-probe tests) and `2973d25`
  (inaccessible procfs remains unknown), both pushed before the implementation.
- `red.txt`: six failing test entries before implementation (five ownership tests and the native
  test module whose implementation did not yet exist).
- `red-launch-race.txt`: the additional launch-race test failing against the first implementation.
  Confirmed child exit must outrank a native reading of a replacement PID; launch timestamp must
  be captured before the asynchronous observer.
- `green.txt`: 11 passing foundation/native tests on Linux.
- `validation.txt`: the required repository gate under `flock /tmp/storytree-heavy.lock`.
  Its `scope:` line explains why every package runs: a new package, lockfile and story registration
  cannot be scoped narrowly. The gate runs `pnpm typecheck` and `pnpm test`.
- `test-ratio.txt`: the whole-repository report; the `all` row is also in the PR body.
- Windows and macOS native tests run in the PR's platform matrix; a Linux pass alone is not proof
  of their adapters. The detached-launch and native lifetime tests have no platform skips.

The live-process tests start actual detached Node processes, verify persisted ownership in a
separate launcher/reader lifetime, retain a child after its explicitly linked parent exits, and
clean every child up. Native tests capture the current process, change lifetime evidence to
represent PID reuse, and verify a real child exit (including Windows exit code 259). Error-path
injection pins unavailable procfs and inaccessible/malformed process observations as unknown.

## 0.2 behavior port and approved corrections

Read-only reference: `/home/mickh/code/Storytree/packages/drive/src/spawn-registry.ts`,
`spawn-record.mjs`, `noticeboard.ts` and `/packages/cli/src/own.ts`. Registration, detached child
attribution, per-record local durability, live/unknown/gone, non-expiring records and offline
operation are rebuilt here, not copied wholesale. The older PID-only limitation, silent
registration failures and swallowed directory-read errors are corrected by the approved 1/2
contracts. Session ownership now uses resolved callers, because two sessions can share a checkout.

No behavior is removed under the “did not last” exception. Listing, stopping, clearing and CLI/MCP
composition are explicitly later capabilities/lanes, with exported package homes. Registry
introduction `faead00e` (2026-08-14), detached registration `f44f1121` (2026-08-15), and last registry
change `005969a8` (2026-08-22) show roughly 44–45 days of persistence to this lane's date. The draft's
larger transcript usage measurement remains the supervisor's reference; this lane makes no new
usage-count claim.

## Lifetime evidence and launch-race review

Linux uses the kernel's start ticks plus boot ID; macOS calls `proc_pidinfo` for its microsecond
start time and `sysctlbyname` for the boot UUID; Windows retains a query handle while reading exact
creation FILETIME and handle state. Sources are linked beside the adapters.

Launch checks the actual ChildProcess completion after the native lookup and one immediate turn.
This avoids attributing a PID replacement during registration: POSIX PID reuse follows reaping,
and libuv dispatches the reaped children as a batch; Node's callback sets exitCode/signalCode.
Windows retains the original process handle until immediately before that callback, preventing
reuse while the handle exists. This rationale was independently reviewed against:

- https://github.com/libuv/libuv/blob/v1.x/src/unix/process.c#L116-L188
- https://github.com/libuv/libuv/blob/v1.x/src/win/process.c#L799-L810
- https://github.com/nodejs/node/blob/v22.x/lib/internal/child_process.js#L254-L277
- https://devblogs.microsoft.com/oldnewthing/20110107-00/?p=11803

`probeProcess` does not grant lasting signal authority. The stopping lane must revalidate/bind the
identity when sending a signal and check all covered explicit children afterward.

## Library hand-off

`library-update/changes.patch` appends as-built paragraphs to the two supplied capability
descriptions; `library-update/README.md` is the supervisor's application checklist. No live store,
claim, decision or question was changed. Decision curation had nothing to do. No owner re-steer or
additional friction record was warranted.

## Full-gate blocker at the file fence

The full repository run passed all 13 package units, including own, and failed only the scripts
unit's boundary assertion. Registering story `own` makes the existing lexical boundary checker
interpret `packages/app/src/updates/own-health.ts` and `own-health.test.ts` as process-ownership
story code in the app frame. They actually implement the app's existing build-health refresh.

`boundary-fix.patch` is a prepared, unapplied rename to `build-health.ts` / `build-health.test.ts`
plus the corresponding relative imports in the test and `packages/app/src/index.ts`. It preserves
all public exports, behavior, state filenames and command names. `git apply --check` passes.
It changes no checker rule and waives no verification. The lane's explicit file fence excludes
these app files, so applying it requires approval. The full gate must then be rerun before opening
a non-draft PR. The supervisor can apply it with `git apply` from the repository root.
