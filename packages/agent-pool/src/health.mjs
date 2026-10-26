// Capability 8 · Reports the pool's health, concerns first. Run on the pool's machine (the Mint box):
// node packages/agent-pool/src/health.mjs [--all]   (concerns, then with --all what is healthy too; exits 1 on a concern)
// It reads the dispatcher's pid, stop file and status lines (launch.mjs), the engines running against the cap, each
// session's logs and report, and the watcher's hand-offs (watch.mjs) with their pull requests on GitHub. It changes
// nothing: restarting, stopping or re-queueing stays the session manager's call. It also flags a lane whose engine started
// with a tool server other than storytree, and a stored claude.ai login on the box (ADR-1175 D1).
import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { poolConfig, readCap } from "./pool-config.mjs";
import { countEngines } from "./queue.mjs";
import { HOME, readPull } from "./watch.mjs";

const run = promisify(execFile);
const DISPATCHER = /launch\.mjs pool( |$)/;
const WATCHER = /watch\.mjs run( |$)/;
/** A live session whose logs have not grown in this long is stuck. */
const STUCK_MS = 90 * 60_000;
/** How far back an ended session's missing report is still a concern. */
const ENDED_MS = 24 * 3_600_000;

const ago = (ms) => {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const mtime = (path) => stat(path).then((found) => found.mtimeMs, () => undefined);

/**
 * The sessions in the dispatcher's status lines: those started since its last start and not ended (running), and every
 * one that ended, with when it started and its exit.
 */
export function readSessions(text) {
  const running = new Map(), ended = [], started = new Map();
  for (const line of text.split("\n")) {
    const [at, word, id, , code] = line.split(" ");
    if (line.endsWith(" dispatcher started")) running.clear();
    else if (word === "start" && id) { started.set(id, at); running.set(id, at); }
    else if (word === "end" && id) {
      running.delete(id);
      ended.push({ id, at: started.get(id), endedAt: at, code: Number(code) });
    }
  }
  return { running: [...running].map(([id, at]) => ({ id, at })), ended };
}

/** When any of a session's logs (pool-<id>-<at>.log, its Claude hand-over and resume logs) last grew. */
async function logGrew(lanesDir, names, id) {
  const times = await Promise.all(names.filter((name) => name.startsWith(`pool-${id}-`) && name.endsWith(".log")).map((name) => mtime(join(lanesDir, name))));
  return Math.max(...times.filter(Number.isFinite), -Infinity);
}

/** The watcher's hand-offs, one `<pr>.json` each in its folder. */
async function handOffs(dir) {
  const found = [];
  for (const name of (await readdir(dir).catch(() => [])).filter((one) => /^\d+\.json$/.test(one)).sort((a, b) => parseInt(a) - parseInt(b))) {
    try { found.push(JSON.parse(await readFile(join(dir, name), "utf8"))); } catch { /* a half-written hand-off is read next time */ }
  }
  return found;
}

/** The tool servers a Claude engine's log says it started with (its init event, near the log's head), or none. */
async function toolServers(path) {
  const file = await open(path, "r").catch(() => undefined);
  if (!file) return [];
  try {
    const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(1 << 20), position: 0 });
    for (const line of buffer.toString("utf8", 0, bytesRead).split("\n")) {
      if (!line.includes('"init"')) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "system" && event.subtype === "init") return (event.mcp_servers ?? []).map((server) => server.name);
      } catch { /* a line cut at the read's end */ }
    }
    return [];
  } finally { await file.close(); }
}

/** A pull request out of the merge queue that would be in it: open, ready, unheld, clean, and its own verify passed. */
function stalledGreen(raw) {
  const checks = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? [];
  return raw.state === "OPEN" && !raw.isDraft && !(raw.labels?.nodes ?? []).some((label) => label.name === "hold")
    && raw.mergeStateStatus === "CLEAN" && !raw.mergeQueueEntry
    && checks.some((check) => check.name === "verify" && check.conclusion === "SUCCESS");
}

/** The pool's state on this machine, read from its files, processes and GitHub, judged into concerns and detail lines. */
export async function poolHealth(b) {
  const L = b.lanesDir, now = b.now();
  const concerns = [], details = [];
  const alive = async (file, mark) => {
    const pid = (await readFile(file, "utf8").catch(() => "")).trim();
    return pid && mark.test(await b.argsOf(pid)) ? pid : undefined;
  };

  const dispatcher = await alive(join(L, "pool.pid"), DISPATCHER);
  const stopFile = await mtime(join(L, "pool-stop")) !== undefined;
  let state;
  if (dispatcher) state = `running (pid ${dispatcher})${stopFile ? ", stopping: pool-stop is there" : ""}`;
  else if (stopFile) state = "stopped on purpose (pool-stop is there)";
  else concerns.push("dispatcher not running, and no pool-stop says that is on purpose");
  details.push(`dispatcher: ${state ?? "not running"}`);

  const [engines, cap] = [await b.count(), await b.maxLanes()];
  if (engines > cap) concerns.push(`${engines} engines running, over the cap of ${cap}`);
  details.push(`slots: ${engines} of ${cap} in use`);

  const sessions = readSessions(await readFile(join(L, "pool.status"), "utf8").catch(() => ""));
  const names = await readdir(L).catch(() => []);
  const running = dispatcher ? sessions.running : [];
  for (const { id, at } of running) {
    const grew = Math.max(await logGrew(L, names, id), Date.parse(at));
    const age = `running ${ago(now - Date.parse(at))}`;
    if (now - grew > STUCK_MS) concerns.push(`${id} stuck: ${age}, its log last grew ${ago(now - grew)} ago`);
    else details.push(`session ${id}: ${age}, its log grew ${ago(now - grew)} ago`);
  }
  for (const { id, at, endedAt, code } of sessions.ended) {
    if (now - Date.parse(endedAt) > ENDED_MS) continue;
    const report = await mtime(join(L, `pool-${id}.report.md`));
    if (report === undefined || (at && report < Date.parse(at))) concerns.push(`${id} ended ${ago(now - Date.parse(endedAt))} ago (exit ${code}) with no report`);
  }

  // A lane runs only on the lane token and loads no tool server but storytree (ADR-1175 D1): its logs and the watcher's
  // fix sessions' of the last day are read for what each engine started with, and a stored claude.ai login is flagged.
  for (const folder of ["", "watch"]) {
    for (const name of (await readdir(join(L, folder)).catch(() => [])).filter((one) => one.endsWith(".log")).sort()) {
      const path = join(L, folder, name), grew = await mtime(path);
      if (grew === undefined || now - grew > ENDED_MS) continue;
      const others = (await toolServers(path)).filter((server) => server !== "storytree");
      if (others.length) concerns.push(`${folder ? `${folder}/` : ""}${name}: its engine started with tool servers other than storytree (${others.join(", ")})`);
    }
  }
  if (b.credentials && await mtime(b.credentials) !== undefined) concerns.push(`a stored claude.ai login is on this box (${b.credentials}); lanes run only on the lane token, so sign the box out of claude.ai`);

  const handed = await handOffs(join(L, "watch"));
  if (handed.length && !(await alive(join(L, "watch", "watch.pid"), WATCHER))) concerns.push(`watcher not running while it holds ${plural(handed.length, "hand-off")}`);
  for (const record of handed) {
    const name = `PR #${record.pr} ${record.increment}`;
    let raw;
    try { raw = await b.pull(record.pr); }
    catch (error) { concerns.push(`${name}: could not read it on GitHub (${String(error.message).split("\n")[0]})`); continue; }
    const pull = readPull(raw, { since: record.fixes?.at(-1)?.at ?? record.handedAt, now, graceMs: 10 * 60_000 });
    if (pull.state === "foreign") { concerns.push(`${name}: its head is not on ${HOME}, or GitHub did not say where it is`); continue; }
    if (stalledGreen(raw)) concerns.push(`${name} stalled green: open, ready, clean and its verify passed, but not in the merge queue`);
    const fixes = record.fixes?.length ?? 0;
    details.push(`hand-off ${name}: handed ${ago(now - Date.parse(record.handedAt))} ago, ${pull.state}${pull.why ? ` (${pull.why})` : ""}, `
      + `${plural(fixes, "fix session")}${record.fixing ? ", one running" : ""}`);
  }

  const summary = `pool healthy: dispatcher ${state}, ${engines} of ${cap} slots, ${plural(running.length, "session")} running, ${plural(handed.length, "hand-off")}`;
  return { concerns, details, summary };
}

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $pr) {
  state isDraft mergeStateStatus headRefOid headRefName isCrossRepository headRepository { nameWithOwner } mergeable mergeQueueEntry { state } labels(first: 20) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
    __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
  timelineItems(itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT], last: 1) { nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } } }
} } }`;

/** The box's lanes folder, cap and processes, from the pool's configuration (pool-config.mjs), and its pull requests through `gh`. */
function boxDefaults({ home = homedir(), env = process.env } = {}) {
  const config = poolConfig({ home, env });
  const { lanesDir, checkout: repo } = config;
  return {
    lanesDir, credentials: join(home, ".claude", ".credentials.json"), now: Date.now, out: console.log,
    argsOf: async (pid) => (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim(),
    count: async () => countEngines((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout),
    maxLanes: () => readCap({ lanesDir, sessions: config.sessions }),
    pull: async (pr) => JSON.parse((await run("gh", ["api", "graphql", "-f", "owner=storytree-ai", "-f", "name=storytree", "-F", `pr=${pr}`, "-f", `query=${QUERY}`],
      { cwd: repo, maxBuffer: 16 * 1024 * 1024 })).stdout).data.repository.pullRequest,
  };
}

/** Concerns first, then with `--all` the healthy details; with no concern, one line. Exits 1 on a concern. `box` overrides the box in tests. */
export async function main(args, box = {}) {
  const b = { ...boxDefaults({ home: box.home, env: box.env }), ...box };
  const { concerns, details, summary } = await poolHealth(b);
  for (const concern of concerns) b.out(`concern: ${concern}`);
  if (args.includes("--all")) for (const line of details) b.out(line);
  else if (!concerns.length) b.out(summary);
  return concerns.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
