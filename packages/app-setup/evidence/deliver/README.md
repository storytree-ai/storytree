# Get storytree — delivery evidence

Capability `capability_790ee7f22546`, story `story_b91056a06337`, increment
`increment_02c57ba72540`. This lane implements the owner's P2/R1/W1/Q1/S1/Windows-first choices.

The [delivery interface](../../src/deliver/README.md) documents the installed paths and the
connection-lane handoff. The [desktop release instructions](../../../../apps/desktop/README.md)
contain the published one-liner. The supervisor's [library patch](library-update/changes.patch)
adds implementation and evidence paragraphs without manufacturing post-snapshot contract IDs.

## Observed here

- `red.txt`: after red commit `e70d469` was pushed, the delivery exports and bootstrap were
  absent and both test units failed. `runtime-red.txt` records the later runtime acquisition red.
- `green.txt`: required `pnpm test`, under `/tmp/storytree-heavy.lock`, with its scope decision
  and package result table. A packaging manifest change makes this a full run.
- `typecheck.txt`: required workspace `pnpm typecheck`, under the same lock.
- `test-ratio.txt`: the report's all row is copied into the PR; it is not a gate.
- `payload-build.txt`: both real Node 24.21.0 Windows downloads passed the pinned upstream
  SHA-256 checks. Each payload contains 20 files, including 13 imported chunks. PE machine
  values are x64 `8664` and arm64 `aa64`; these Windows executables were not run on Linux.
- `delivery.test.ts`: temporary homes check complete payload inventories, architecture,
  first launch without app.json, a repeat/hidden-app launch request, app readiness failures,
  preservation of the last delivery record/0.2/project choice, stable paths after payload
  replacement, command conflicts and real command execution from a fresh shell.
- `bootstrap.test.ps1`: real PowerShell 7.6.6 on Linux, injected download/install/launch/PATH
  effects, clean x64/arm64 selection, repeats, every failed step and safe retry, matching
  release selection, corrupted-download refusal and preserving/appending PATH strings.
- `apps/desktop/src/main/delivery.test.ts`: runs the actual built CLI, hook, setup and delivery
  helper plus an MCP initialize/tools-list exchange from a temporary folder with spaces and
  empty PATH, outside a checkout. It does not register a real agent or use live project data.
- `apps/desktop/check-install.mjs`: Windows CI installs the actual NSIS app in a path with
  spaces, runs its bundled x64 Node and the same tool proof, validates the payload, and inspects
  arm64 Node's PE architecture. See the PR's Windows check for its observed result.

Node hashes are pinned from [Node's release checksums](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt).
The complete release is published using the existing draft/upload/publish flow. No release
was published manually by this lane.

## Still required on the laptop

- [ ] Run the published command on clean Windows x64 and native arm64, with no Node/npm,
      checkout, previous app launch record or project; verify a visible app and database.
- [ ] Repeat in the same folder and a second folder, including while the app window is hidden;
      preserve projects/settings and a pre-existing 0.2 installation and data.
- [ ] Refuse/interruption at download and NSIS steps, inspect the named failure/retry, then
      retry successfully while retaining the previous usable installation.
- [ ] Open a fresh terminal after Windows PATH notification. Exercise command conflicts,
      including the user's actual terminal/profile setup; verify the explicit fallback works.
- [ ] Take a real ordinary release update with an active agent tool process, then start a
      fresh agent session. Verify NSIS handles files in use and the compatible runtime/tool
      payload is available at the same durable paths. The Linux path-replacement test cannot
      prove Windows executable locking or an actual update.
- [ ] Run agent-link contract 8.6's real two-harness walkthrough with capability 2, including
      approvals and received hook events. Delivery success alone makes no connection claim.
- [ ] Exercise the published script with Windows PowerShell 5.1 as well as PowerShell 7.

No decision/question/claim/closure or live library write was made. All new code is inside
the lane's file fence. Read-only review found the non-directory PATH entry issue; the fix and
regression assertion are included. No owner-level fork or persistent friction item was needed.
