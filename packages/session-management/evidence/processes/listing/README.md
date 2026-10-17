# Listing API evidence and integration residue

Scope: capability 3 of `story_9abd84ab493f`, on arc `arc_197b9208adfc`, increment
`increment_5df7e7b316ab`. **This landing is partial: the inventory API is built; the installed
CLI/MCP front doors are not built. Do not close the whole increment on this PR.**

## API hand-off

`@storytree/own/listing` exports `listRuns(options)` and `renderInventory(reading)`:

```ts
const self = await listRuns({ owner: ownerFromCall(call) });
const all = await listRuns({ scope: 'all' }); // no caller required, no stop authority
```

`home` is the foundation ledger directory. `probe` retains the foundation's testing seam.
The reading contains machine, scope, owner (when known), observation time, rows, shared lifecycle
readings, gaps, launch coverage and completeness within that coverage. It does not connect to the
app or database. It does not register, signal or remove a process or reimplement ledger/probes.

Each row keeps the foundation run, process and request evidence plus age, relation to the caller,
whether it ended without a report, and a stop offer/refusal. Self includes explicit parent-session
and valid parent-run delegation; all scopes retain readable foreign records as uncertain. Exclusion
of the inspecting command compares its native lifetime, so an older run at its reused PID remains.
Missing self identity refuses with a pointer to `storytree own --all`; it never looks like empty work.

A surface may supply `shared` lifecycle readings. They never acquire session stop authority. A
surface may supply `stopAction(runId)` only once it actually installs that action; it must revalidate
ownership/lifetime when invoked. The API emits it only for owned, local, live identities. Without
an installed stop entry point the API honestly reports that no action is available. `complete`
means complete for the recorded coverage, not idle and not ready to close; live work is normal.

## Red and green

- Red commit `997f79e`: four behavioral tests, pushed before implementation; `red.txt` records
  all four failing because `listRuns` did not exist.
- `green.txt`: those four tests and a native live-to-gone integration check pass on Linux.
- `typecheck.txt`: full repository typecheck under `/tmp/storytree-heavy.lock`.
- `validation.txt`: scoped `pnpm test`, under the same lock. Read its `scope:` and result table.
- `gate.txt`: required combined gate; guidance is NOT RUN because no roles or library notes changed.
- `test-ratio.txt`: the report's `all` row is copied into the PR.

The fixtures pin request/process separation, exact inspector exclusion, delegated ownership,
anonymous all-session attribution, foreign records, corrupt-record gaps, stop-action refusal and
empty coverage. The native test launches a real owned Node process, sees it live, stops only that
test child and observes it gone. CI must prove the native source path on real Windows/macOS;
Linux results alone do not. This PR does not prove a standalone installed native bundle or arm64.

## Why the requested front doors remain

The file fence specifically allows only own's listing home, agent-link's tools directory and CLI.
No answer arrived to the lane's requests for the additional dependency/packaging edits. The lane
therefore prepared `front-door-dependencies.patch` but did not apply it. `git apply --check` passes.
It is a dependency-only starting patch, not a claim that the remaining integration is implemented.

1. `agent-link` cannot import `@storytree/own/listing` without adding its workspace dependency to
   `packages/agent-link/package.json` and updating `pnpm-lock.yaml`, both outside the fence.
   The CLI manifest is within the fence, but its matching lock update is outside. Relative
   cross-story imports are prohibited by ADR-0649 and the package-boundary check.
2. Normal MCP tools route to the app/database before execution (`tools/server.ts`, `Define`).
   The new registration must use an offline path, retaining harness caller metadata and refusing
   the synthetic MCP-server fallback session for self inventory. Hook-corrected Claude identities
   currently require activity-log reads; no offline hook identity seam is established. The
   supervisor must settle/wire this with the agent-link integration rather than invent identity.
3. Native probes import Koffi. Both standalone builders bundle JavaScript but do not stage its
   physical native package. `agent-link/src/bins/build.ts` is outside the fence. The installed
   Windows payload stages x64 and arm64 in `apps/desktop/tools.mjs`, also outside the fence;
   copying only the build computer's native dependency is insufficient for both target payloads.
4. `locateStorytree()` is the existing public shared-app read, but returns only running/address,
   with no native lifetime, PID, age or separate database child identity. Front doors can pass a
   clearly limited shared lifecycle reading; a complete app-process row needs a new public seam.
5. `@storytree/own/stopping` is still empty on this branch's main base. The sibling stopping lane
   must expose the stop API before a usable action can be installed. No guessed stop command is
   advertised by default and this lane changed none of the stopping files.

Next integration unit: apply the approved dependency change, install the offline MCP registration
and thin CLI family using this API and existing harness identity, connect the stopping API, acquire
shared lifecycle readings, stage native binaries for both installed Windows architectures, and
prove the built CLI plus MCP against one offline ledger on Linux/macOS/Windows before landing.
All ownership/report policy stays in own; front doors parse/contextualize and call its exports.

## Port, curation and library hand-off

0.2's read-only `packages/cli/src/own.ts` supplied the inventory behavior: live work is a successful
read; self refuses absent identity; all-session attribution does not grant stop rights; unreadable
records and launch coverage remain visible. No 0.2 code was copied. No behavior was removed under
“did not last”; the approved draft's existing measurement (155 self and 97 all-form occurrences in
the local Claude corpus, with separate Codex measurements) remains reference evidence, not a new
measurement by this lane. Front-door behavior is deferred for the concrete integration blockers,
not abandoned due to usage.

`library-update/changes.patch` plus its checklist is the only library hand-off. No store was read
or written, no claim was taken/released and no decision/question record was made. Decision curation
had nothing to do. No owner redirection arrived during this lane; no re-steer was recorded.
