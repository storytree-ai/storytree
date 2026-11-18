# Agent runner (`@storytree/agent-pool`)

The agent pool's lane runner, dispatcher and watcher, for whichever machine runs it. Each machine configures it in its own
file, `~/.storytree/agent-pool.json` (or the file `AGENT_POOL_CONFIG` names), never in this repository (ADR-1216 D1):
the fields are below. Its plan lives in the library (story_b2051c0f7372).

## The machine file (ADR-1066 D2 G, ADR-1179, ADR-1216 D1)

Every field may be left out. `~` is the home folder of the machine reading the file.

- `machine`: the ssh host the pool runs on, which a hand-over from any other machine reaches; none, and a hand-over
  works only on the pool's own machine (or through the library).
- `checkout`: the shared checkout every lane's worktree is cut from and the watcher runs from; by default this one.
- `machineCheckout`: the pool's checkout on `machine`, as written there (its own `~`), where a hand-over over ssh runs;
  by default `checkout`.
- `lanes`: the folder of briefs, logs, hand-offs and the pool's controls; by default `~/.storytree/agent-pool`.
- `briefs`: a folder whose `pool-brief.md`, `pool-brief-plan.md`, `pool-brief-read-only.md` or `pool-brief-project.md`,
  where it holds one, a lane is briefed with in place of the one in `src/`; by default none.
- `addDirs`: folders each engine may write besides its worktree (the lanes folder is always one).
- `sessions`: pins the cap on engines running at once (the lanes folder's `night-max-lanes` overrides it live); by default
  none, and the cap is what the machine's cores and memory allow (ADR-1142).
- `laneMemory`: the memory each lane's scope may use (systemd's MemoryMax: bytes, or a size such as `"12G"`), past which
  the kernel kills that lane alone (runner 1.27); by default the machine's memory less every other lane's share.
- `engines`: `{ codex: { model }, claude: { model }, switchAt }`: the model each engine runs (none, the engine's own
  default) and the share of Codex's weekly allowance at which lanes switch to Claude (by default 100, when it is spent).
- `identity`: `{ name, email }`: who a lane's commits are by when its environment sets no git identity; by default none,
  and git's own configuration decides. Read only whole.
- `watcher`: `{ fixesPerRed, fixesPerPullRequest, intervalSeconds }`: fix sessions per red, per pull request, and the
  seconds between looks; by default 2, 6 and 60.
- `machineOnly`: `true`, and the dispatcher takes only work whose machine field names this machine, plans no arc,
  leaves untagged work to the shared pool (ADR-1179 D2), and starts a lane only while plugged in and while the library
  and GitHub answer (D3); by default false. `windows/register-laptop-pool.ps1` writes a laptop's.
- `projects`: `[{ name, checkout, checks, review }]`: the storytree projects whose ready work the pool offers, each lane
  started in its project's checkout on this machine; storytree's may leave its checkout out (it is `checkout`), any other
  must name one. Another project's lanes are briefed with its `checks`, the commands its lane runs before it opens a pull
  request, in order, and its `review`, what its lane does to have its change reviewed (`pool-brief-project.md`). By
  default, or empty, storytree alone.
- `cloud`: `{ enabled, cap, trigger, reviews }`: the trial overflow into Claude Code cloud sessions while the box is
  saturated (ADR-1264, `src/cloud.mjs`): on only with `enabled: true`, at most `cap` cloud lanes at once (by default 2),
  fired through the cloud task's API trigger `trigger` (a `trig_` id, or `CLOUD_TRIGGER_ID` in `~/.storytree/secrets.json`,
  beside its token `CLOUD_TRIGGER_TOKEN`). Switched on, it still fires nothing until `reviews: true` says the cloud
  environment loads the plugin that provides storytree quality (3.47).

The running dispatcher reads `projects` and `sessions` again as it runs, so an edit to either reaches its next survey; an
edit to any other field restarts it once its running lanes end (3.39). The environment variables the pool read before
(`LANES_DIR`, `CODEX_STOP_AT`, `WATCH_BOX_HOST`, `WATCH_FIX_LIMIT`, `WATCH_FIX_CAP`, `WATCH_INTERVAL_S`) still override it,
and a file that cannot be read stops the pool rather than running it on defaults.

## Its commands

Run from the repository's root; those that read the library or storytree's TypeScript run under `node --import tsx`.

- `launch.mjs pool`: one dispatcher over every active arc's ready increments; exits 3 to restart on its own code change.
- `launch.mjs slots`: the engines running now, and the cap.
- `launch.mjs ready [project] [--drained]`: as JSON, the engines running, the cap, the lanes folder and the work the pool
  would start now, from every project it serves or the one named.
- `launch.mjs probe [checkout]`: whether the library and GitHub answer from the checkout, naming each refusal; exit 1 on one.
- `launch.mjs stop`: ends the dispatcher `pool.pid` names, if it is one.
- `launch.mjs cloud`: the cloud overflow trial's switch, counts and lanes (ADR-1264).
- `runner.mjs run <brief-file> <log> <err> [add-dir ...]`, `runner.mjs status`: one lane, and the engine reading.
- `feed.mjs reoffer <increment> [--project <name>] --reason "…"`: offer an increment the pool gave up on to it again.
- `health.mjs [--all]`: concerns, then with `--all` what is healthy too; exits 1 on a concern. It changes nothing.
- `pause.mjs pause [--repo <owner/name>] [--wait-minutes <n>]`: no new work; waits until no other lane runs and no pull
  request is in the merge queue, then says what is still open. `pause.mjs resume` takes work again; `pause.mjs status
  [--repo <owner/name>]`. Pause and resume start no process.
- `reclone.mjs [--checkout <folder>] [--repo <git url>] [--lanes <folder>] [--apply]`: moves a machine onto a fresh clone at
  a cut-over to a new repository (process_761459dc626c B7 on the box, B10 on the laptop). Dry by default; with `--apply` it
  moves the checkout and each follow-main worktree aside to `<path>.before-<time>`, never deleting either, clones,
  installs and remakes them, sets the watcher's hand-offs aside on the box and restarts a watcher that was running, then
  checks storytree's own commands reach the library. On the box it refuses while the pool is not paused, or while the
  dispatcher's loop still runs from the checkout.
- `watch.mjs hand <pr> <increment> [--session <id>] [--keep-open] [--refused [--holder <session>]]`: records the hand-off
  and starts the watcher. `--keep-open`: one of several pull requests for its increment, so on MERGED the increment stays
  open (4.11). `--refused`: a fix session hands back untouched because a claim refused it, so it does not count against
  the limit; `--holder` names the session the refusal said holds the work (4.14).
- `watch.mjs handover <pr> <increment> [--keep-open] [--repo <owner/name>]`: from any machine, `hand` on the box, else over
  ssh, else through the library. `--repo` is refused when it is not the one its increment's library lands on (4.51).
- `watch.mjs run` (the watcher: one per box; keeps `watch` running), `watch.mjs watch` (its look loop; exits 3 on its own
  code change), `watch.mjs status`.
- `watch.mjs release-fix --pr <n> | --wait <increment> | --question <id>`: a release fix session records what it left.
- `watch.mjs forget`: at a cut-over to a new repository, sets every hand-off aside, since its pull request numbers start
  again (4.40).
- `watch.mjs verdict <pr> flake|elsewhere|fix|owner --summary <text> [--parked <increment>] [--question <id>]`: a review
  session's one verdict (4.37).

## Why the watcher reads releases and the exemptions list itself

The watcher retries a stopped release (4.16) rather than a workflow beside `rerun-unrun.yml`: the once-only retry and the
alarm read the same runs and attempt numbers, so one reader decides both and its decisions are pure and tested, where a
workflow's shell would be untested; and the watcher already reads GitHub every minute. A box that is down retries
nothing, but then it starts no lanes either. `rerun-unrun.yml` still reruns a CI job no runner took.

It also tells the owner, as one FYI per commit, each change on main to `.github/secret-check-exemptions.txt`
(question_82ab3da6eb69: awareness, not prevention; nothing blocks a pull request). The watcher, not a scheduled process,
is the detector: it already runs on the box all the time with no model, while a scheduled process needs a model's run to
come round. It reads main's history rather than the pull requests handed to it, because a change can reach main by a pull
request no lane handed over; each FYI is about `<list>@<sha>`, asked of the library before it is recorded, so a change is
told once however often the history is read, and none is missed while the box was down.

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
stopped"; `pause.mjs resume` removes it and starts nothing itself. `storytree settings set module agent-pool off` stops
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
