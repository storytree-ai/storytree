# Connect an agent

`@storytree/app-setup/connect` exports `connectAgents` and `disconnectAgents`.
Pass `harnesses: ["claude-code"]`, `["codex"]`, or both and the installed server command:

```ts
const installed = installedToolServerCommand(bundledNodePath, installedMcpScriptPath);
const results = await connectAgents({ installed, harnesses: ["claude-code", "codex"] });
```

The delivery lane supplies absolute paths to its own Node and bundled
`storytree-mcp.mjs` through this small interface. The adjacent files remain the existing
`storytree-hook.mjs` and `storytree.mjs`. No cwd, project, npm, repository path, or
machine Node is captured in registration. Stable installed paths survive resource updates.

Each result reports tools registration and a next action separately; `hooks` is always
`not verified`. A new agent session reaches the existing setup check. Its project consent
and received-event verification remain authoritative. Project/managed harness configuration
can override a user registration and must be diagnosed in that session.

Claude Code uses the top-level `mcpServers.storytree` in `~/.claude.json`, or
`$CLAUDE_CONFIG_DIR/.claude.json`. Codex uses `[mcp_servers.storytree]` in
`$CODEX_HOME/config.toml` (default `~/.codex`). The installed Codex CLI validates a
private temporary copy and performs removal there; the user file is replaced only after
validation and a concurrent-edit check. Claude JSON is validated before editing. Neither
adapter overwrites an incompatible `storytree` entry, including a legacy 0.2 connection.
A different MCP name would break the existing agent-link tool-call hook matcher.

Disconnect removes only the chosen MCP registration and hook commands matching this
installation's exact command/arguments. Other hook commands in the same group survive.
The shared launcher is removed only after both harness configurations show no connection,
and only when its contents match this installation's generated launcher. Failed inspection,
conflicting entries or failed hook cleanup keep the command and give a retry action.
Setup still registers hooks for all detected homes: another setup check may re-create a
disconnected harness's hooks. This does not re-register its MCP server.

After delivery, the PowerShell one-liner offers Claude Code, Codex, both, or skip. It calls
the installed CLI explicitly, so a conflicting command on PATH cannot redirect setup.
From a terminal, use `storytree setup connect --claude`, `--codex`, or both switches;
`storytree setup disconnect claude-code` or `codex` removes one connection. Run
`storytree setup --help` for all setup verbs. `setup install` and `setup remove` retain
their existing hook/command meaning.

The CLI forwards to app-setup's bundled `storytree-deliver.mjs` helper. It reads the schema-1
`delivery.json` from the current storytree home (when `finish` has not yet written it, the
`node` and `storytree-mcp.mjs` installed beside the helper) and calls these same connection functions
with `tools.node` and `tools.mcp`. No project or running app is needed for these commands.
Failure for any selected agent exits nonzero while reporting each result. Missing or
invalid delivery metadata names the installer as the recovery path. This adds no second
installer or setup check. See the [join evidence](../../evidence/join/README.md) and
[connection evidence](../../evidence/connect/README.md) for proofs and acceptance limits.

A dev build has no installed helper, so `storytree setup connect` refuses there. To connect a dev build's own
commands to a throwaway home instead (its own HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, storytree home and Postgres),
run `pnpm --filter @storytree/app-setup dev-home <dir> --codex [--claude]`, source the `env.sh` it writes, and
remove it with `dev-home <dir> --remove`. Claude Code's sign-in is not copied: export `CLAUDE_CODE_OAUTH_TOKEN`
(`claude setup-token`) before starting it there. See the [dev home evidence](../../evidence/dev-home/README.md).
