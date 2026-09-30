# What environment Codex gives a tool server (2026-09-30, Mint box)

Increment 145660924471 asked whether storytree's tool server, started by Codex, sees Codex's own
`CODEX_HOME`. Measured with Codex 0.153.4 (`codex exec`, Linux), a throwaway `CODEX_HOME` holding a
copy of the sign-in and one tool server, `probe.mjs`, which writes the environment it was started
with to `seen.json` and answers the MCP handshake. The running Codex lanes' `~/.codex` was not touched.

| `[mcp_servers.probe]` in the throwaway home's config.toml | `seen.json` |
|---|---|
| `command`, `args` only | `{"CODEX_HOME":null,"keys":["HOME","LANG","LOGNAME","PATH","SHELL","USER"]}` |
| plus `env_vars = ["CODEX_HOME"]` | `{"CODEX_HOME":"/tmp/cxprobe.pDw2/home","keys":["CODEX_HOME","HOME",…]}` |
| plus `env = { CODEX_HOME = "/tmp/cxprobe.pDw2/home" }` | the same |

So Codex strips `CODEX_HOME`: the tool server's setup check (`defaultHomes`, `registerHooks`,
`codexHookTrust`) falls back to `~/.codex` while Codex reads its hooks from its own home. Connect
now writes `env = { CODEX_HOME = "<home>" }` into the registration when the home is not `~/.codex`.

Not measured here: Codex on Windows (its default environment list is longer), and a custom-home
user whose registration predates this, which connect now reports as an incompatible entry.
