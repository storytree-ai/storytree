// Capability 12 · The Mint pool runs its lanes under the box's cap (ADR-0955 D2): one dispatcher at a time, at most
// the box's cap of engines at once, each lane's brief composed from its header, notes and the pool's rules.
import { readFile, writeFile } from "node:fs/promises";
import { posix } from "node:path";

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

/**
 * Wait, a minute at a time, until fewer than `max` engines run; say so once when it has to wait. `max` may be a
 * reader of the cap, read on every poll, so a raised cap frees a waiting runner without a lane ending.
 */
export async function waitForSlot({ max, count, sleep, onWait }) {
  let waited = false;
  for (;;) {
    const running = await count();
    if (running < (typeof max === "function" ? await max() : max)) return running;
    if (!waited) { onWait(running); waited = true; }
    await sleep(60_000);
  }
}

/** A lane's brief: its header, the increment's own notes when it has any, then the pool's rules. */
export function composeBrief({ title, intro, notes = "", common }) {
  return [`# ${title}`, "", intro, "", ...(notes ? [notes.replace(/\n*$/, ""), ""] : []), common].join("\n");
}

/**
 * One runner at a time (the dispatcher, the watcher): refuse while the pid file names a live process whose command
 * line is one of its runners (`marks`); a dead runner's leftover pid, or a pid reused by another program, does not block.
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
