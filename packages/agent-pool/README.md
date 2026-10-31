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

## The box's keeper (increment_89c736caa64a)

On the Mint box the user's crontab runs `src/keep.mjs` once a minute (`node packages/agent-pool/src/keep.mjs install` adds the
line, once). It starts the dispatcher's loop (`launch-pool.sh run`) and the watcher (`watch.mjs run`) when either is down.
What cron starts lives in `cron.service`, not in a login session or the user manager, so the desktop logging out, or
`user@1000` exiting as it did twice on 2026-10-31, no longer stops the pool, and it comes back after a reboot unattended.
It leaves the loop stopped while `pool-stop` is there, or when the dispatcher's last run ended on exit 75, which it says
once in `pool.status` for pool health and the session manager. Its own output is `keep.log` in the lanes folder.

## The laptop's dispatcher (ADR-1179)

The owner's Windows laptop runs the same dispatcher (`launch.mjs pool`) for work tagged `machine=laptop` only, one lane at a
time, starting a lane only while it is plugged in and the library and GitHub answer. `windows/register-laptop-pool.ps1`
(read it, then run it once; `-DryRun` shows what it would do) writes its configuration to `~/.storytree/agent-pool.json`
(`machineOnly`, `sessions: 1`, Claude), forces the Claude engine in its lanes folder, and registers a Task Scheduler entry that
runs `windows/laptop-pool.ps1` at logon. Its checkout (by default `C:\code\storytree03-dispatcher`) is a git worktree of the
joined checkout, never a second clone, which storytree refuses: the script first runs `launch.mjs probe <checkout>`, which
names whichever of the library and GitHub refuses there, and stops before writing anything. Run again from another
checkout, it points the configuration at it and stops the old task and its dispatcher (`launch.mjs stop`). Pause it with `pool-stop` in the lanes folder, as on the box; delete it to resume.
