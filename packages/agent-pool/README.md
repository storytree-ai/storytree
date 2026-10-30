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

## The laptop's dispatcher (ADR-1179)

The owner's Windows laptop runs the same dispatcher (`launch.mjs pool`) for work tagged `machine=laptop` only, one lane at a
time, starting a lane only while it is plugged in and the library and GitHub answer. `windows/register-laptop-pool.ps1`
(read it, then run it once; `-DryRun` shows what it would do) writes its configuration to `~/.storytree/agent-pool.json`
(`machineOnly`, `sessions: 1`, Claude), forces the Claude engine in its lanes folder, and registers a Task Scheduler entry that
runs `windows/laptop-pool.ps1` at logon. Pause it with `pool-stop` in the lanes folder, as on the box; delete it to resume.
