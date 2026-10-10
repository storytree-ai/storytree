# Process ledger

`@storytree/processes` owns local process ownership and observation. This foundation implements
capabilities 1 and 2 of `story_9abd84ab493f`. It requires neither a running app/database nor a
claim. Listing, stopping and closing have exported empty homes (`/listing`, `/stopping`,
`/closing`) for the following lanes.

## Common launch boundary

Both harness adapters pass Session management's already resolved `ToolCall.caller` and `agent` to
`ownerFromCall`. A manual terminal supplies its explicit session binding. No folder, git branch,
command text, PID adoption or session-age heuristic supplies ownership.

```ts
import { launchOwned, ownerFromCall, observeRuns, recordRequestOutcome } from '@storytree/processes';

const result = await launchOwned({
  owner: ownerFromCall(call), // or { session: boundSession, harness: 'manual' }
  project: call.project, folder: call.folder,
  command: process.execPath, args: ['server.mjs'],
});
if (result.status === 'untracked') {
  // Surface gap.reason and gapRecorded. pid, when present, may still be running.
} else {
  // The complete launch record is already on disk. result.pid is the actual spawned process.
  // Only when the caller has timeout evidence:
  await recordRequestOutcome({ run: result.run.id, owner: result.run.owner,
    outcome: 'timed-out', evidence: 'request req-17 exceeded its deadline' });
}
const observation = await observeRuns();
```

`command` is an executable and `args` are literal arguments, passed without an implicit shell.
For shell syntax, explicitly launch the platform's shell. Work is detached with ignored standard
streams, so caller exit cannot keep pipes open or end the child. Command output capture and
interactive terminals are not part of this boundary. Short-lived commands still leave records.

The tests call this same API with Claude Code, Codex and manual identities. Installing CLI/MCP
entry points and Session management's offline composition seam belong to the integration/listing
lane; this PR changes neither front door. Existing harness activity hooks do not register runs.

## Durable records and child links

By default the ledger is under `${STORYTREE_HOME}/own`, or `~/.storytree/0.3/own`. `home` overrides
that ledger directory for an isolated caller/test. Each launch gets an opaque UUID (never a PID
or session name as a file path), and an immutable `runs/<uuid>.json`. Writes sync the file before
atomic publication. POSIX also syncs its directory. Separate `requests/<uuid>.json` events hold
caller evidence; `gaps/<uuid>.json` holds known launch gaps when its storage is writable. A failed
gap write is returned explicitly and must be carried by the calling surface.

A record contains owner session/harness/agent, optional explicit parent session, machine name,
optional project, executable/argv, absolute folder, launch time, PID, native birth observation
and optional `parentRun`. A child launched through this API with `parentRun` keeps its own record
and that link after the parent exits. Cross-session links require the supplied `parentSession`
and matching harness; same-session subagents retain Session management's explicit subagent ID.
These fields are trusted local caller context, not an authentication boundary against arbitrary
code running as the same OS user. They never come from command/folder/time matching.

Only explicitly registered descendants are covered. A shell can spawn an arbitrary detached
server outside the boundary; it is untracked, never guessed to belong to its parent's record.
Later tree stopping must traverse explicit links and say exactly which processes it covers.

## Observation seam for later lanes

- `readLedger()` returns readable runs, request evidence and gaps independently. A corrupt file
  or failed directory read cannot hide readable siblings. It never removes records.
- `observeRuns()` attaches current process observations and caller-supplied request outcomes.
  Request outcome defaults to `unknown`; an explicit timeout stays reported even if work later
  completes. Turn/session end, restarts, claims and age cannot expire a run.
- `readProcess(pid)` captures native evidence. `probeProcess(identity)` compares that lifetime:
  Linux boot ID/start ticks; macOS boot UUID/native microsecond start time; Windows exact native
  creation FILETIME (an absolute epoch, not a counter restarted at boot).
- A different lifetime is `gone` for the original run. Missing evidence/native access is
  `unknown`. A record whose birth identity was unavailable stays uncertain and never gains
  signal authority by later finding the same PID. Foreign-machine records are unknown.
- Probes are snapshots. The stopping lane must bind/revalidate identity when signalling; this
  foundation neither signals nor provides a PID-only stop operation.

Ownership is scoped to this computer. Every observation carries `LAUNCH_COVERAGE`; an empty
tracked ledger is not a claim that the whole computer, unregistered work or another machine is idle.
