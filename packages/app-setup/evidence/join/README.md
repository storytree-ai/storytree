# Installed setup joins delivery to connection

Increment `increment_1bb076ad0f30`, story `story_b91056a06337`, arc `arc_cfc7db517fae`.

The PowerShell one-liner prompts after delivery for Claude Code, Codex, both, or skip.
It invokes the delivered Node and CLI directly, including when a conflicting storytree
command was preserved. The people's CLI exposes:

```text
storytree setup connect --claude
storytree setup connect --codex
storytree setup connect --claude --codex
storytree setup disconnect claude-code
storytree setup disconnect codex
```

The CLI forwards arguments to app-setup's already bundled `storytree-deliver.mjs`.
The helper reads `delivery.json` from the current storytree home, validates its schema
and absolute Node/MCP paths, and calls the existing `connectAgents` or `disconnectAgents`.
No new installer, registration implementation, package dependency, or lockfile edit was
needed. Existing `setup install` and `setup remove` keep their hook/command meaning.

Each selected agent reports tools registration separately from hooks not verified, then
asks the user to start a new session in their folder and call `check_setup`. Missing
metadata, tools, harnesses or conflicting settings produce recovery messages and a
nonzero exit. A partial failure still reports the other agent's successful registration.

## Proof

- Red commit `188d3a6` was pushed before running the tests. [red.txt](red.txt) records
  four observed failures: the missing PowerShell selection function and the installed
  CLI's missing connection caller.
- The CLI tests build the real CLI and app-setup helper into a temporary installation,
  run outside a project with isolated user/config homes, and use fake harness executables.
  Real JSON/TOML files prove both/single selection, repeat idempotence, scoped disconnect,
  preservation, partial failure exit status, absent/malformed metadata, absent tools and
  harnesses, and the unchanged legacy hook verbs. Spaces occur in installed/test paths.
- Real PowerShell 7 runs the chooser with injected choices for all four options, invalid
  input and connection failure, alongside the existing delivery orchestration tests.
- [green.txt](green.txt) records the gate and final checks; [test-ratio.txt](test-ratio.txt)
  is the boundary report. The gate's affected scope includes both changed packages and
  their dependents. Guidance is NOT RUN because no roles or standing notes changed.

## Later Windows acceptance

The laptop lane must still exercise the published one-liner on fresh Windows x64 and
native arm64, including Windows PowerShell 5.1, real NSIS installation, fresh-terminal
PATH propagation and conflicting commands. Real signed-in Claude Code and Codex must
accept the installed server, run in two chosen folders, ask for project consent and
demonstrate all received hook events (agent-link 8.6). Repeat, repair/retry, selective
disconnect and a release update with live agent processes also require that walkthrough.
Linux/fake harness tests and Windows CI do not attest those observations.

The supervisor applies the [library patch and checklist](library-update/README.md) after
merge, then closes the increment. This lane wrote no live library records, claims,
decisions or questions. No decision-log or role curation was needed; durable integration
knowledge is in these package docs and the pending library patch.
