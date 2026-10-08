// Capability 12 · A Mint queue runs its lanes one at a time (ADR-0929 D3), or a night track up to its lane limit
// beside lanes writing other packages (ADR-0947): one runner per queue, a line leaves the queue only when its lane
// ends, the stop file ends the runner after its running lanes, and at most the box's cap of engines runs at once. The box's launch-night.sh and launch-mintlib.sh are thin wrappers over launch.mjs, which
// composes these.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, posix } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const ENGINES = [["codex", "exec"], ["codex", "e"], ["claude", "-p"], ["claude", "--print"]];

/** Whether a process's command line starts an engine: `codex exec …` or `claude -p …`, run directly or by node. */
export function isEngine(args) {
  const words = args.trim().split(/\s+/);
  const start = /^node\d*$/.test(posix.basename(words[0] ?? "")) ? 1 : 0;
  const name = posix.basename(words[start] ?? ""), verb = words[start + 1];
  return ENGINES.some(([engine, flag]) => name === engine && verb === flag);
}

/**
 * The engines running on the box, from `ps -eo pid=,ppid=,args=`: each lane counts once. An engine started by
 * another engine (Codex's node wrapper runs its native binary with the same arguments) is the same lane, and a
 * process that only mentions an engine (a wrapper, a grep, a brief quoting `codex exec`) is not one.
 */
export function countEngines(table) {
  const rows = table.split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map(([, pid, ppid, args]) => ({ pid, ppid, args }));
  const engines = new Set(rows.filter((row) => isEngine(row.args)).map((row) => row.pid));
  return rows.filter((row) => engines.has(row.pid) && !engines.has(row.ppid)).length;
}

/** Wait, a minute at a time, until fewer than `max` engines run; say so once when it has to wait. */
export async function waitForSlot({ max, count, sleep, onWait }) {
  let waited = false;
  for (;;) {
    const running = await count();
    if (running < max) return running;
    if (!waited) { onWait(running); waited = true; }
    await sleep(60_000);
  }
}

/** A lane's brief: its header, the increment's own notes when it has any, then the queue's common brief. */
export function composeBrief({ title, intro, notes = "", common }) {
  return [`# ${title}`, "", intro, "", ...(notes ? [notes.replace(/\n*$/, ""), ""] : []), common].join("\n");
}

export async function queueLines(file) {
  try { return (await readFile(file, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

/**
 * Take the line naming the increment that ran out of the queue, wherever it now sits: a dispatcher may have
 * rewritten the queue while the lane ran, so line 1 can be different work (increment_03c44d94d5fc).
 */
export async function popRan(queueFile, id) {
  const lines = await queueLines(queueFile);
  const at = lines.indexOf(id);
  if (at < 0) return false;
  lines.splice(at, 1);
  await writeFile(queueFile, lines.length ? `${lines.join("\n")}\n` : "");
  return true;
}

/**
 * One runner per queue: refuse while the pid file names a live process whose command line is one of this
 * queue's runners (`marks`); a dead runner's leftover pid, or a pid reused by another program, does not block.
 * `argsOf(pid)` is that process's command line, or "" when it is gone.
 */
export async function holdRunner({ pidFile, pid = process.pid, marks, argsOf }) {
  const old = (await readFile(pidFile, "utf8").catch(() => "")).trim();
  if (old && old !== String(pid)) {
    const args = await argsOf(old);
    if (marks.some((mark) => mark.test(args))) return { held: false, by: old };
  }
  await writeFile(pidFile, `${pid}\n`);
  return { held: true };
}

const LINE = /^[A-Za-z0-9_-]+$/;

/**
 * Run the queue from its head, up to `limit` lanes at once (a number, or a reader read on every look; ADR-0947). With no lane running the head starts; beside running lanes, `beside(queued, running)`
 * names the queued line (or work it added to the queue) that may run with them, or nothing, and the runner
 * then waits for a lane to end or `intervalMs` to look again. A lane's line leaves only when that lane ends:
 * 75 (an engine failing at once) keeps it and stops the runner, and so does any failure when `stopOnFailure`;
 * the stop file stops it too. A stopping runner starts no more lanes and ends once its running lanes end.
 * When the queue empties with nothing running, `refill` may add work (true: look again) or not (false: end).
 */
export async function runQueue({ queueFile, stopFile, runLane, stopOnFailure = false, refill = async () => false,
  limit = 1, beside = async () => undefined, intervalMs = 15 * 60_000, sleep = (ms, options) => wait(ms, undefined, options),
  exists = async (path) => existsSync(path), now = Date.now, say = console.log }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  const running = new Map();
  let ending, popping = Promise.resolve();
  // Lanes ending together take their lines one after another, so neither rewrite of the file loses the other's.
  const pop = (id) => (popping = popping.then(() => popRan(queueFile, id)));
  const start = (id) => running.set(id, (async () => {
    try {
      const code = await runLane(id);
      if (code === 75) ending ??= { code: 75, message: `track stopped: engine failing, ${id} kept at the head of the queue` };
      else if (stopOnFailure && code !== 0) ending ??= { code, message: `lane for ${id} failed: stopping with it still queued` };
      else await pop(id);
    } catch (error) { ending ??= { error }; }
    finally { running.delete(id); }
  })());
  const end = async (outcome) => {
    await Promise.all(running.values());
    const last = ending ?? outcome;
    if (last.error) throw last.error;
    if (last.message) dated(last.message);
    return last.code;
  };
  for (;;) {
    if (ending) return end(ending);
    if (await exists(stopFile)) return end({ code: 0, message: `stopped by ${basename(stopFile)}` });
    const queued = (await queueLines(queueFile)).filter((line) => !running.has(line));
    if (running.size === 0) {
      const [head] = queued;
      if (!head) { if (!(await refill())) return 0; continue; }
      if (!LINE.test(head)) { dated(`bad queue line '${head}': stopping`); return 1; }
      start(head);
      continue;
    }
    const free = running.size < (typeof limit === "function" ? await limit() : limit);
    const next = free ? await beside(queued.filter((line) => LINE.test(line)), [...running.keys()]) : undefined;
    if (next && !running.has(next)) { start(next); continue; }
    const look = new AbortController();
    await Promise.race([...running.values(), ...(free ? [Promise.resolve(sleep(intervalMs, { signal: look.signal })).catch(() => {})] : [])]);
    look.abort();
  }
}
