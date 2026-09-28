# Installed own doors

Increment `increment_8d245936227b`, arc `arc_197b9208adfc`. This resumes #158's withdrawn doors and applies both prepared patches with current clear and identity wiring.

- CLI: `storytree own`, `own --all`, `own stop <run…>`, `own clear`.
- MCP: `list_own_runs`, `list_all_runs`, `stop_own_run`, `clear_own_runs`, taught by the habits card.
- Both installed bundles and the standalone CLI stage Koffi's loader and the exact native target in its supported `build/koffi/<ABI>/koffi.node` prebuild layout. Desktop payloads replace the host native package with the matching Windows x64/arm64 package before the manifest is written. Root pnpm supportedArchitectures installs these targets; their already-pinned lockfile entries did not change.
- Doors remain thin: listing, stopping and conservative clearing stay in `packages/own`. Clear returns separate removed/retained/failed/gaps and a closing reading, carrying clear gaps forward. The app/database public lifecycle reading remains shared, unknown and without signal authority.
- CLI identity is the harness session in its environment. Missing or competing harness signals refuse self actions. MCP resolves exact hook call ids online; offline Codex uses per-call session/thread metadata, and unresolved Claude calls refuse. All-session inspection remains available without identity or a library connection.

## Evidence

Red commit `851cb73` was pushed before the focused run. `red.txt` records missing CLI/MCP doors and the missing habits teaching. CI’s first installer check found that scoped native-package paths failed payload verification, after all three native test suites passed. The PR was held as a draft while fixing it. Red commit `7e8c87b` adds the public installer verifier to the real built-CLI test; `red-payload.txt` reproduces the rejection locally and `green-payload.txt` proves the corrected layout still loads and stops real children through both bundles. No verifier rule was relaxed. `windows-installer-first-failure.txt` records the original CI failure.

Existing contracts 7.1 and 7.3 are retained and extended to the new toolbox / both harness clients.

`typecheck.txt` and `test.txt` record the required direct commands under the heavy-work lock. `gate.txt` is the final gate after test cleanup was made to wait for child exit before deleting working directories, for Windows. Read scope and the final result tables. Passing per-test detail is omitted from the committed check summaries. `test-ratio.txt` carries the all row.

Built tests use temporary directories outside the checkout, with no database for offline reads and actual native child processes for stop. They also verify anonymous refusal, conflicting CLI identities, cross-session/sibling refusal, clear retention/removal and unreadable-record gaps. The online Claude test uses isolated test Postgres, exact hook records and a session reset. No live store is touched.

`windows-staging.txt` records actual desktop payload assembly on Linux, SHA-256 manifest checks for both doors and native loader/module, and PE machine checks for x64/arm64. Only real Windows execution can prove DLL loading, FILETIME/handle observation and signalling, installed launchers and harness behavior. CI exercises x64 Windows; arm64 and the owner's installed laptop acceptance remain separate.

The only own-package change is the listing action type/rendering fix from #158's patch: a surface may offer its installed CLI command OR MCP tool, without inventing an unavailable equivalent command. No launch, ownership, stopping or clearing algorithm changed. Every edited file is inside the lane's fence.

## Handoff and curation

Apply `library-update/changes.patch` using its checklist, then close the supervisor-held increment after merge. The installer path mismatch is retained here as concrete integration friction; it was fixed in the shared builder within the fence. The snapshot predates this story, so the patch uses the prior committed hand-offs as its explicit base. No decision/question records or live-store writes were made. Curation had no decision or durable-guidance change to make; no owner re-steer arrived. No fence blocker remains. Stop after this PR, per lane instructions; no successor.
