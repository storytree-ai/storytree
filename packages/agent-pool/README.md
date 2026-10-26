# Agent runner (`@storytree/agent-pool`)

The Mint box's lane runner, dispatcher and watcher. Its configuration is `agent-pool.json` at the repository root;
its plan lives in the library (story_b2051c0f7372).

## The lane login (ADR-1175)

A lane runs only on the lane token: `CLAUDE_CODE_OAUTH_TOKEN`, from the runner's environment or
`~/.storytree/secrets.json` on the box, minted with `claude setup-token`. Without it the runner starts no engine,
exits 75 so the lane stays queued, and asks the owner once in the library to mint a new one. Every engine it starts
carries `ENABLE_CLAUDEAI_MCP_SERVERS=false`, so no claude.ai connector loads, and `node src/health.mjs` flags a lane
whose engine started with any tool server other than storytree, and a stored claude.ai login
(`~/.claude/.credentials.json`) on the box.

The box's own `~/.claude/settings.json` also sets `"disableClaudeAiConnectors": true`. That is a setting of the box,
never of this repository.
