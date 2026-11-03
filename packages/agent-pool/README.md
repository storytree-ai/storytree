# Agent runner (`@storytree/agent-pool`)

The agent pool's lane runner, dispatcher and watcher, for whichever machine runs it. Each machine configures it in its own
file, `~/.storytree/agent-pool.json` (or the file `AGENT_POOL_CONFIG` names), never in this repository (ADR-1216 D1):
`src/pool-config.mjs` says what each field means. Its plan lives in the library (story_b2051c0f7372).

## The lane login (ADR-1175)

A lane runs only on the lane token: `CLAUDE_CODE_OAUTH_TOKEN`, from the runner's environment or
`~/.storytree/secrets.json` on the box, made with `claude setup-token`. Without it the runner starts no engine,
exits 75 so the lane stays queued, and asks the owner once in the library to make a new one. Every engine it starts
carries `ENABLE_CLAUDEAI_MCP_SERVERS=false`, so no claude.ai connector loads, and `node src/health.mjs` flags a lane
whose engine started with any tool server other than storytree, and a stored claude.ai login
(`~/.claude/.credentials.json`) on the box.

The box's own `~/.claude/settings.json` also sets `"disableClaudeAiConnectors": true`. That is a setting of the box,
never of this repository.

## As a part, started as services (ADR-1216 D3)

Its manifest makes it the part `agent-pool`, declaring two services, `dispatcher` and `watcher` (run always), that the
service host runs once a machine turns them on (`storytree settings set service agent-pool/dispatcher on`, and the
same for `agent-pool/watcher`), in place of the keeper below. Each adopts its process when one already runs, and
starts it in a systemd scope of its own when the host runs under systemd, so the host's restart kills no lane.
Stopping the dispatcher's service ends the dispatcher alone; its lanes run on and finish. A dispatcher held after
exit 75 is let go by `storytree services restart agent-pool/dispatcher`. The service host names the part as a
development dependency, so switching the agent runner off takes its services off without taking the host's own
`services` commands with it. Its dependents reach it only through its declared interface (`storytree.declares`:
`./launch` for the ready pool, `./runner` for the lane runner), resolved by `agentRunnerEntry` in `src/interface.mjs`,
which answers with a stand-in plugin's entry while the part is switched off.

## The box's dispatcher and watcher (ADR-1216 D3)

On the Mint box the service host (`storytree-host.service`, a systemd user unit kept past logout by lingering) runs
the two services, turned on in the box's settings (`storytree settings set service agent-pool/dispatcher on`, and the
same for `agent-pool/watcher`). They replace the crontab keeper (`keep.mjs`, increment_89c736caa64a) and the
`launch-pool.sh run` loop, both retired. `pause.mjs` writes `pool-stop`, which the dispatcher's service reads as "leave it
stopped"; `pause.mjs resume` removes it and starts nothing itself. `storytree settings set part agent-pool off` stops
both services (a stand-in's run under the same names, if one is named).

## The laptop's dispatcher (ADR-1179)

The owner's Windows laptop runs the same dispatcher (`launch.mjs pool`) for work tagged `machine=laptop` only, one lane at a
time, starting a lane only while it is plugged in and the library and GitHub answer. `windows/register-laptop-pool.ps1`
(read it, then run it once; `-DryRun` shows what it would do) writes its configuration to `~/.storytree/agent-pool.json`
(`machineOnly`, `sessions: 1`, Claude on the model `-ClaudeModel` names, if any), forces the Claude engine in its lanes folder, and registers a Task Scheduler entry that
runs `windows/laptop-pool.ps1` at logon. Pause it with `pool-stop` in the lanes folder, as on the box; delete it to resume.
Its `checkout` is a folder of its own, never the owner's working checkout: a git worktree of that checkout (a second clone
of a project is refused, one folder per project per machine), today `C:\code\storytree03-dispatcher`, the script's default.
Because it is a linked worktree, a lane makes its workspace from the main checkout (`pnpm storytree workspace <increment>
--reason …` there). The script first runs `launch.mjs probe <checkout>`, which names whichever of the library and GitHub
refuses there (a second clone among them), and stops before writing anything. Run again from another checkout, it points
the configuration at it and stops the old task and the dispatcher it left running (`launch.mjs stop`).
