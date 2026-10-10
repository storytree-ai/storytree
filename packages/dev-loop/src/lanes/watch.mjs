// Capability 13 · A watcher lands a handed-over pull request (ADR-0955 D3). A Mint session ends once its pull request
// is open and its gate is green, and hands the pull request here; this script, not a model, watches CI and the merge
// queue: on MERGED it closes the increment and releases the session's claims, on a red it starts one fix session.
// node packages/dev-loop/src/lanes/watch.mjs hand <pr> <increment> [--session <id>]   (records it and starts the watcher)
// node packages/dev-loop/src/lanes/watch.mjs handover <pr> <increment>               (from any machine: `hand` on the box, else over ssh)
// node packages/dev-loop/src/lanes/watch.mjs run                                     (the watcher: one per box)
// node packages/dev-loop/src/lanes/watch.mjs status
import { execFile, spawn as spawnChild } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { countEngines, holdRunner } from "./queue.mjs";

const run = promisify(execFile);
const RED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
// The queue's removals that the Requeue workflow puts back once; one it left out past its grace is red.
const EJECTED = new Set(["FAILED_CHECKS", "BRANCH_PROTECTION_FAILURE"]);
const MARKS = [/watch\.mjs run( |$)/];

/**
 * A pull request, as GitHub's GraphQL returns it, read as merged, closed, red or pending. Red is a failed check on
 * its head, or a removal from the merge queue after `since` that the Requeue workflow has not undone in `graceMs`.
 */
export function readPull(pull, { since, now, graceMs }) {
  const head = pull.headRefOid;
  if (pull.state === "MERGED") return { state: "merged", head };
  if (pull.state === "CLOSED") return { state: "closed", head };
  const checks = pull.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  const failed = checks.filter((check) => RED.has(check.conclusion ?? check.state));
  if (failed.length) {
    return { state: "red", head, why: failed.map((check) => `${check.name ?? check.context} failed`).join("; "),
      logs: failed.map((check) => check.detailsUrl ?? check.targetUrl).filter(Boolean) };
  }
  const removal = pull.timelineItems?.nodes?.at(-1);
  const removedAt = Date.parse(removal?.createdAt);
  if (!pull.mergeQueueEntry && EJECTED.has(removal?.reason?.toUpperCase()) && removedAt > Date.parse(since) && now - removedAt > graceMs) {
    return { state: "red", head, why: `the merge queue removed it (${removal.reason}) and did not take it back`, logs: [] };
  }
  return { state: "pending", head };
}

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  state headRefOid mergeQueueEntry { state }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
  timelineItems(itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT], last: 1) { nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } } }
} } }`;

/** One pull request from GitHub through `gh`, the box's signed-in GitHub command line. */
export async function lookOnGitHub(pr, { repo, since, now = Date.now, graceMs = 10 * 60_000 }) {
  const { stdout } = await run("gh", ["api", "graphql", "-f", "owner=storytree-ai", "-f", "name=storytree", "-F", `pr=${pr}`, "-f", `query=${QUERY}`],
    { cwd: repo, maxBuffer: 16 * 1024 * 1024 });
  return readPull(JSON.parse(stdout).data.repository.pullRequest, { since, now: now(), graceMs });
}

const recordPath = (dir, pr) => join(dir, `${pr}.json`);
const save = (dir, record) => writeFile(recordPath(dir, record.pr), `${JSON.stringify(record, null, 2)}\n`);

async function records(dir) {
  const names = await readdir(dir).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
  const found = [];
  for (const name of names.filter((name) => /^\d+\.json$/.test(name)).sort((a, b) => parseInt(a) - parseInt(b))) {
    try { found.push(JSON.parse(await readFile(join(dir, name), "utf8"))); } catch { /* a half-written hand-off is read next time */ }
  }
  return found;
}

/**
 * The increments handed to the watcher in `dir`, each with why the pool leaves it alone: its pull request is landing,
 * or a fix session works it. The watcher clears the event wait before a fix session claims the increment, so this,
 * not the wait, keeps the dispatcher from starting a second session in between.
 */
export async function handedOff(dir) {
  return (await records(dir)).map((record) => ({ increment: record.increment,
    note: `PR #${record.pr} is with the Mint box's watcher${record.fixing ? ", and a fix session works it" : ""}` }));
}

/**
 * Hand a pull request to the watcher: park the increment on an event wait so no session claims it while it lands
 * (checking back in three days, after which the pool may take it again: an event wait needs that day), record the hand-off (one per pull request; handing back keeps its fix sessions), and start the watcher.
 */
export async function hand({ dir, pr, increment, session, storytree, startWatcher, now = Date.now }) {
  await mkdir(dir, { recursive: true });
  const old = (await records(dir)).find((record) => record.pr === pr);
  await storytree(["arc", "increment", "wait", increment, "--for", "event", "--note",
    `PR #${pr} is open and green and handed to the Mint box's watcher, which closes this on its merge or starts a fix session on a red.`,
    "--check-back", new Date(now() + 3 * 86_400_000).toISOString().slice(0, 10)]);
  await save(dir, { fixes: [], fixing: null, ...old, pr, increment, session, handedAt: new Date(now()).toISOString() });
  await startWatcher();
}

/**
 * Hand a pull request over from any machine, with the handing session's own id so the watcher releases its claims:
 * on the box it is `hand`; elsewhere it runs `hand` on the box through `remote` (ssh). When the box cannot be reached
 * it refuses with the reason, and the session lands the pull request itself.
 */
export async function handOver({ pr, increment, session, onBox, local, remote }) {
  const fallback = `Wait for the merge yourself: watch \`gh pr checks ${pr}\` for MERGED, then close ${increment} with --disposition landed --pr ${pr}.`;
  if (!session) return { code: 1, lines: ["no session id (CLAUDE_CODE_SESSION_ID or CODEX_THREAD_ID): the watcher could not release this session's claims, so it is not handed over.", fallback] };
  const args = ["hand", String(pr), increment, "--session", session];
  if (onBox) { await local(args); return { code: 0, lines: [] }; }
  try {
    const said = await remote(args);
    return { code: 0, lines: [said.trim(), `Close out with: pnpm storytree session close-out --safe yes --why "PR #${pr} open and green, handed to the watcher"`].filter(Boolean) };
  } catch (error) {
    return { code: 1, lines: [`could not reach the Mint box's watcher: ${error.message.trim().split("\n").at(-1)}`, fallback] };
  }
}

function fixBrief({ pr, increment, why, logs, n, limit }) {
  return `# Fix session ${n} of ${limit}: pull request #${pr} (${increment}) is red

The Mint box's watcher started you: a session opened PR #${pr} for ${increment}, saw its gate green and handed it over,
and it has since gone red: ${why}.${logs.length ? `\nThe failing runs: ${logs.join(", ")}.` : ""}

Your job is that pull request and nothing else. Work from ~/code/storytree03 and follow its AGENTS.md as the session-orchestrator.
- Find the PR's branch (\`gh pr view ${pr} --json headRefName\`) and a worktree on it (\`git worktree list\`), or add one for it
  under .claude/worktrees, and claim the increment there: \`pnpm storytree workspace attach ${increment} --folder <worktree> --reason "fix PR #${pr}"\`.
- Read the failing log (\`gh run view <run> --log-failed\`, or \`gh pr checks ${pr}\`). Suspect a stale branch first: merge
  origin/main, run \`pnpm install\`, and \`pnpm gate\`. Then fix what is really broken, see \`pnpm gate\` green and push.
  Never force-push, squash or \`gh pr merge\`.
- Hand it back: \`node packages/dev-loop/src/lanes/watch.mjs hand ${pr} ${increment}\`, then
  \`pnpm storytree session close-out --safe yes --why "PR #${pr} fixed and handed back to the watcher"\`, and end.
- If it needs the owner (a decision, a sign-in, a spend), raise the question on the increment's arc holding the increment, then close out and end.
`;
}

/**
 * One look at every hand-off. MERGED: clear the wait, close the increment landed, release what its session still
 * holds and forget it. CLOSED: clear the wait and forget it. Red: with no fix session running and an engine slot
 * free, clear the wait and start one; once `limit` have run, put the increment on an owner wait instead.
 */
export async function watchOnce({ dir, look, storytree, startFix, alive, room, limit, now = Date.now, say }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  // A step the library refuses (a wait already cleared, an increment closed by hand) is said, not retried forever.
  const tell = (args) => storytree(args).catch((error) => { dated(`storytree ${args.slice(0, 3).join(" ")} refused: ${error.message.split("\n")[0]}`); return ""; });
  for (const record of await records(dir)) {
    const { pr, increment } = record;
    let pull;
    try { pull = await look(pr, record); }
    catch (error) { dated(`PR #${pr}: could not read it (${error.message.split("\n")[0]}); looking again next time`); continue; }
    if (pull.state === "merged" || pull.state === "closed") {
      await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      if (pull.state === "merged") {
        await tell(["arc", "increment", "close", increment, "--disposition", "landed", "--pr", String(pr)]);
        const board = await tell(["noticeboard"]);
        for (const line of board.split("\n")) {
          const held = /^\s*- (?:increment|capability) (\S+)\s/.exec(line);
          if (held && record.session && line.includes(` ${record.session} `)) {
            await tell(["workspace", "release", held[1], "--holder", record.session, "--reason", `PR #${pr} merged; released by the watcher`]);
          }
        }
        dated(`PR #${pr} merged: closed ${increment}`);
      } else dated(`PR #${pr} closed without merging: ${increment} no longer waits on it`);
      await rm(recordPath(dir, pr), { force: true });
      continue;
    }
    if (record.fixing && await alive(record.fixing.pid)) continue;
    if (record.fixing) { record.fixing = null; await save(dir, record); }
    if (pull.state !== "red") continue;
    if (record.fixes.length >= limit) {
      await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
      await storytree(["arc", "increment", "wait", increment, "--for", "owner", "--note",
        `PR #${pr} is still red after ${record.fixes.length} fix sessions: ${pull.why}.${pull.logs.length ? ` Failing runs: ${pull.logs.join(", ")}.` : ""}`
        + ` Fix sessions' logs: ${record.fixes.map((fix) => fix.log).join(", ")}.`]);
      await rm(recordPath(dir, pr), { force: true });
      dated(`PR #${pr} still red after ${record.fixes.length} fix sessions: ${increment} waits on the owner`);
      continue;
    }
    if (!(await room())) continue;
    await tell(["arc", "increment", "unwait", increment, "--for", "event"]);
    const n = record.fixes.length + 1;
    const fix = await startFix({ pr, increment, n, brief: fixBrief({ pr, increment, why: pull.why, logs: pull.logs, n, limit }) });
    record.fixing = { pid: fix.pid };
    record.fixes.push({ at: new Date(now()).toISOString(), head: pull.head, pid: fix.pid, log: fix.log });
    await save(dir, record);
    dated(`PR #${pr} red (${pull.why}): fix session ${n} of ${limit} started, log ${fix.log}`);
  }
}

/** Start the watcher unless a live one holds its pid file; `spawn` starts it and returns its pid, written at once. */
export async function ensureWatcher({ pidFile, argsOf, spawn }) {
  const old = (await readFile(pidFile, "utf8").catch(() => "")).trim();
  const args = old ? await argsOf(old) : "";
  if (MARKS.some((mark) => mark.test(args))) return false;
  await writeFile(pidFile, `${await spawn()}\n`);
  return true;
}

async function argsOf(pid) {
  return (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim();
}

function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const lanesDir = env.LANES_DIR || join(home, "storytree-lanes");
  const repo = join(home, "code", "storytree03");
  const dir = join(lanesDir, "watch");
  const script = fileURLToPath(import.meta.url);
  // The watcher and its fix sessions belong to no agent session: they outlive the one that handed over.
  const free = { ...env };
  for (const name of ["CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID"]) delete free[name];
  const detached = (args, log, cwd) => {
    const out = openSync(log, "a");
    const child = spawnChild(process.execPath, args, { cwd, env: free, detached: true, stdio: ["ignore", out, out] });
    child.unref();
    return child.pid;
  };
  return {
    lanesDir, repo, dir, pidFile: join(dir, "watch.pid"), status: join(lanesDir, "watch.status"), argsOf,
    limit: Number(env.WATCH_FIX_LIMIT) || 2, intervalMs: Number(env.WATCH_INTERVAL_S ?? 60) * 1000, now: Date.now,
    session: env.CLAUDE_CODE_SESSION_ID?.trim() || env.CODEX_THREAD_ID?.trim() || "",
    storytree: async (args) => (await run("pnpm", ["-s", "storytree", ...args], { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout,
    look: (pr, record) => lookOnGitHub(pr, { repo, since: record.fixes.at(-1)?.at ?? record.handedAt }),
    alive: async (pid) => /lanes\/runner\.mjs run /.test(await argsOf(pid)),
    room: async () => countEngines((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout)
      < (Number((await readFile(join(lanesDir, "night-max-lanes"), "utf8").catch(() => "")).trim()) || 5),
    startFix: async ({ pr, n, brief }) => {
      const base = join(dir, `fix-${pr}-${n}`);
      await writeFile(`${base}-brief.md`, brief);
      const pid = detached([join(script, "..", "runner.mjs"), "run", `${base}-brief.md`, `${base}.log`, `${base}.err`,
        join(home, "code", "storytree03-wt"), lanesDir], `${base}.runner.log`, repo);
      return { pid, log: `${base}.log` };
    },
    startWatcher: () => detached([script, "run"], join(lanesDir, "watch.status"), repo),
    // The box is the machine whose lanes folder has the lane runner; any other reaches it as `ssh mint`.
    onBox: existsSync(join(lanesDir, "run-lane.sh")),
    remote: async (args) => (await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", env.WATCH_BOX_HOST || "mint",
      `cd ~/code/storytree03 && node packages/dev-loop/src/lanes/watch.mjs ${args.join(" ")}`], { timeout: 120_000 })).stdout,
    sleep: (ms) => wait(ms),
  };
}

/** `handover <pr> <increment>`, `hand <pr> <increment> [--session <id>]`, `run` or `status`; `box` overrides the box's paths and processes in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults(), ...box };
  const out = b.out ?? console.log;
  if (args[0] === "handover" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    const { code, lines } = await handOver({ pr: Number(args[1]), increment: args[2], session: b.session, onBox: b.onBox,
      local: (hand) => main(hand, box), remote: b.remote });
    for (const line of lines) out(line);
    return code;
  }
  await mkdir(b.dir, { recursive: true });
  if (args[0] === "hand" && /^\d+$/.test(args[1] ?? "") && /^increment_\w+$/.test(args[2] ?? "")) {
    const at = args.indexOf("--session");
    const session = at > 0 ? args[at + 1] ?? "" : b.session;
    await hand({ dir: b.dir, pr: Number(args[1]), increment: args[2], session, storytree: b.storytree, now: b.now,
      startWatcher: () => ensureWatcher({ pidFile: b.pidFile, argsOf: b.argsOf, spawn: b.startWatcher }) });
    out(`PR #${args[1]} handed to the watcher (${join(b.dir, `${args[1]}.json`)}); ${args[2]} waits on it until it merges.`);
    out(`Close out with: pnpm storytree session close-out --safe yes --why "PR #${args[1]} open and green, handed to the watcher"`);
    return 0;
  }
  if (args[0] === "status") {
    const found = await records(b.dir);
    const pid = (await readFile(b.pidFile, "utf8").catch(() => "")).trim();
    const live = pid && MARKS[0].test(await b.argsOf(pid));
    out(`watcher: ${live ? `running (pid ${pid})` : "not running"}`);
    for (const record of found) out(`PR #${record.pr} ${record.increment}: handed ${record.handedAt}, ${record.fixes.length} fix sessions${record.fixing ? `, one running (pid ${record.fixing.pid})` : ""}`);
    if (!found.length) out("no hand-offs");
    return 0;
  }
  if (args[0] !== "run") { out("usage: watch.mjs handover <pr> <increment> | hand <pr> <increment> [--session <id>] | run | status"); return 2; }
  const say = b.say ?? ((line) => out(line));
  const runner = await holdRunner({ pidFile: b.pidFile, pid: b.pid ?? process.pid, marks: MARKS, argsOf: b.argsOf });
  if (!runner.held) { say(`watcher ${runner.by} is running: not starting`); return 1; }
  for (;;) {
    try { await watchOnce({ ...b, say }); }
    catch (error) { say(`${new Date(b.now()).toISOString()} look failed: ${error.message.split("\n")[0]}`); }
    await b.sleep(b.intervalMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
