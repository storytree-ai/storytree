# Stop the work I own — capability 4

`@storytree/own/stopping` exports `stopOwned`. It uses the foundation ledger, owner records and
process probes; this lane adds no parallel registry and never clears records.

```ts
import { stopOwned } from '@storytree/own/stopping';
const result = await stopOwned({
  owner: { session: resolvedSession, harness: 'codex', agent: 'orchestrator' },
  targets: [runId, anotherRunId],
});
// result.ok covers only result.scope on result.machine.
// Always retain coverage, nativeTree, gaps and each target's members/excluded in presentation.
```

Each target gets `stopped`, `already-gone`, `refused` or `incomplete`, its recorded owner, covered
members, their final readings and per-phase attempt results. A malformed/unregistered target is
refused without signal. A refused target or unconfirmed covered survivor makes `ok` false. Even
successful stops keep records for capability 5. Empty target lists are unsuccessful. Default
waits are two seconds per phase; `graceMs`/`forceMs` accept 0–30000 ms. These bound verification
waits, not the total time spent reading an arbitrarily large ledger or an unresponsive filesystem.

## Ownership and coverage

A resolved session orchestrator (or explicitly bound manual session without an agent) owns its
session's runs and sessions linked through registered `parentSession` delegation with matching
harness. A named subagent can stop its own subagent runs, not its parent or siblings. An unknown
agent does not gain authority. Target selection uses run UUIDs, not PIDs or command text.

Membership is the named run plus registered `parentRun` descendants, including detached children
whose root already exited. Every member has to establish ownership; conflicts, changed records,
late descendants and ledger gaps prevent a successful complete-membership verdict. Ownership is
reread before every delivery, and every phase checks all covered members. A new conflicting
registration during an earlier member's delivery cannot authorize signalling the next member.

**This is registered membership, not proof of an entire OS process tree.** Every result names the
computer, `scope: registered-runs-and-linked-descendants`, `nativeTree: unconfirmed`, and the
foundation's full coverage warning. A shell's unregistered children remain outside coverage; a
successful registered-membership result must never be displayed as “the native tree is gone” or
“nothing is running.” No process group is signalled, no OS descendant is adopted, and no shared
app/database lifecycle is taken over. The supplied foundation explicitly leaves these descendants
untracked. Native containment or comprehensive registration would require a later launch-boundary
increment; this lane does not claim that proof. Final integration must preserve these fields.

The ledger is a trusted local boundary, not protection against another program running as the
same OS user forging/changing files. Concurrent launches have no common interlock with stop;
observed late registrations are incomplete, and coverage is an observation, not a promise that
future work cannot start.

## Native delivery

- Linux opens a pidfd, rechecks the foundation birth identity, then sends SIGTERM/SIGKILL through
  that descriptor. A later PID reuse cannot redirect it. Missing libc pidfd symbols or kernel
  support is an explicit failure; no bare-PID fallback. The current implementation requires libc
  wrappers supplied since glibc 2.36.
- macOS reads combined BSD birth identity and PID version from `PROC_PIDT_BSDINFOWITHUNIQID`,
  then uses `proc_signal_with_audittoken` for SIGTERM/SIGKILL. The kernel checks PID version at
  delivery. A changed exec/version, unavailable private ABI/export, short read or permission
  failure stays unsuccessful unless the independent probe confirms disappearance. No bare-PID
  fallback. The combined ABI and token construction follow Apple XNU implementation; support on
  older macOS releases is not established by the current-runner CI test.
- Windows compares FILETIME on the same process handle used for forced termination. The polite
  phase posts WM_CLOSE only to that live process's top-level windows. Detached console work has
  no safe targeted polite channel, so reports `unsupported`, waits, rechecks and uses bounded
  force. It never broadcasts console events or calls `taskkill /T`. Force acceptance alone is
  insufficient; the foundation re-probes every covered member.

Native references: [Linux pidfd signal](https://man7.org/linux/man-pages/man2/pidfd_send_signal.2.html),
[glibc wrapper release](https://sourceware.org/pipermail/libc-alpha/2023-August/150827.html),
[Apple combined ABI](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h),
[Apple audit-token signal](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c),
[Windows TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess),
[Windows WM_CLOSE](https://learn.microsoft.com/en-us/windows/win32/learnwin32/closing-the-window).

## Evidence and port boundary

`red.txt` captures the missing API's eight failed contract tests after pushed red commit `be5c094`,
then the additional ownership-change regression failing before its fix. `green.txt` captures the
local gate, whose scope is packages/own and the boundary checker. Native tests use real launched
processes: stale identity leaves the actual process alive; a detached registered child is forced
away after root exit; polite stop ends a cooperative process without touching another owner.
Windows CI additionally runs a hidden native window/message loop to prove WM_CLOSE, plus real
handle termination for detached console work. Linux cannot attest Windows FFI, window delivery,
handle rights, or macOS private-ABI availability: those require the respective CI runner. Windows
arm64 and arbitrary protected/elevated processes are not proven by the x64 CI runner.

The 0.2 reference `packages/drive/src/spawn-stop.ts` preserves explicit ownership, two bounded
attempts, post-stop verdicts and survivor record retention. It was introduced by `51317b26` on
2026-08-14, with no later file commits through local HEAD `2845cf81` on 2026-09-08 (about 24 days).
Its POSIX group/PID fallback and Windows taskkill tree shortcut checked only the root; these are
replaced under approved 4.2–4.4, not removed as unused behavior. No “did not last” exclusion is
claimed. The supplied draft records successful historic stops and a larger owner measurement.

The sibling CLI/MCP listing files were absent from origin/main at build time. Per the lane's
explicit dependency rule, no new front-door family or cross-lane file is invented here. The
supervisor's integration follow-up must mount `storytree own stop <run…>` and `stop_own_run` over
this exported function, preserving failures and coverage.
