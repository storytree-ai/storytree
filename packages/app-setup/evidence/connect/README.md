# Connect an agent — build evidence

Story `story_b91056a06337`, capability `capability_01dc27eec57f`, increment
`increment_02c57ba72540`, arc `arc_cfc7db517fae`.

The red commit is `dd4963b` (pushed before the failing run). [red.txt](red.txt)
records the absent connection API. [green.txt](green.txt) records the required repository
run; [typecheck.txt](typecheck.txt) records the required typecheck. Both run under
`flock /tmp/storytree-heavy.lock`. Changing agent-link makes the test scope **full**.

The tests cover either/both harnesses, unrelated settings and legacy entries, repeat,
conflict, invalid settings, missing harness/runtime, interrupted settings writes and retry,
folder inheritance, project-consent boundary, scoped disconnect, mixed hook groups, and
independent results. Tools registration always reports hooks as not verified. Existing
agent-link setup tests prove each missing hook remains named until the event is received.
The new folder test uses an installed-process stand-in plus the real setup check; it is
not a live agent session or an installed-artifact proof.

`flock /tmp/storytree-heavy.lock node --import tsx packages/app-setup/evidence/connect/native-cli.mjs`
exercises the actual installed CLI adapters in temporary homes without account access or
agent sessions. [native-cli.txt](native-cli.txt) records its result. Claude Code 2.1.281 and
Codex CLI 0.153.4 were present on this Linux box. Codex removal can normalize blank lines;
unrelated values and comments are retained. No user's actual configuration was edited.

Formats were confirmed before implementation from local `claude mcp add --help`,
`codex mcp add/list/get --help`, temporary-home `mcp add` runs, and the current
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp) and
[official OpenAI MCP documentation](https://developers.openai.com/codex/mcp).
The inspected CLI forms are `claude mcp add --scope user --transport stdio storytree -- <node> <server>`
and `codex mcp add storytree -- <node> <server>`. Actual implementation writes Claude's JSON
and appends a Codex table in staging, verifies it with `codex mcp get --json`, then saves.
Only fixed CLI words enter Windows' command shell; installed paths remain file data.

## Handoff and limits

Delivery consumes `installedToolServerCommand(bundledNodePath, installedMcpScriptPath)`
and passes its result into the exported connection/disconnection functions. Both paths
must be absolute and the server must be `storytree-mcp.mjs`, with the existing hook/CLI
bundles beside it. The interface is defined here because the sibling export was still
empty. This lane does not edit delivery, app/CLI wiring, package metadata, or the lockfile.
The installed chooser/caller still needs integration in the owning lane; this PR provides
the callable behavior and per-harness result model, not an installed UI walkthrough.

Not proved here: real Windows x64/arm64 installed-artifact execution, Windows CLI/shim
invocation, path-with-spaces installation and repeat/retry on Windows, no-prior-launch-record
handoff, a real release update retaining the link, or agent-link 8.6's paid two-harness
walkthrough in two real project folders. These stay with the laptop acceptance lane.
No project library, claim, decision, question or closure record was read or written.

The [library patch and checklist](library-update/README.md) are for the supervisor.
No decision-log curation, owner re-steer or memory graduation was needed. Review found
and corrected absent-Codex cleanup and dangling-symlink preservation before landing. The first macOS CI run also exposed
a temporary-directory alias in the folder-inheritance test; [ci-macos-red.txt](ci-macos-red.txt)
records the failure. The assertion now compares the real path of the same directory.
