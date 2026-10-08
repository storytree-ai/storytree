// Capability 12 · A Mint queue runs its lanes one at a time (ADR-0929 D3): one runner per queue, a line leaves
// the queue only when its lane ends, the stop file ends the runner after its lane, and at most the box's cap of
// engines runs at once. The box's launch-night.sh and launch-mintlib.sh are thin wrappers over launch.mjs, which
// composes these.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, posix } from "node:path";

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

/**
 * Run the queue a lane at a time, from its head. A lane's line leaves only when the lane ends: 75 (an engine
 * failing at once) keeps it and stops the runner, and so does any failure when `stopOnFailure`. When the queue
 * empties, `refill` may add work (true: look again) or not (false: the runner ends).
 */
export async function runQueue({ queueFile, stopFile, runLane, stopOnFailure = false, refill = async () => false,
  exists = async (path) => existsSync(path), now = Date.now, say = console.log }) {
  const dated = (message) => say(`${new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z")} ${message}`);
  for (;;) {
    if (await exists(stopFile)) { dated(`stopped by ${basename(stopFile)}`); return 0; }
    const [head] = await queueLines(queueFile);
    if (head) {
      if (!/^[A-Za-z0-9_-]+$/.test(head)) { dated(`bad queue line '${head}': stopping`); return 1; }
      const code = await runLane(head);
      if (code === 75) { dated(`track stopped: engine failing, ${head} kept at the head of the queue`); return 75; }
      if (stopOnFailure && code !== 0) { dated(`lane for ${head} failed: stopping with it still queued`); return code; }
      await popRan(queueFile, head);
      continue;
    }
    if (!(await refill())) return 0;
  }
}
