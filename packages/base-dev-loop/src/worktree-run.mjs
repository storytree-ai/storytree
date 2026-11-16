// Capability 4 · Running the tests. One live `pnpm test` at a time in a worktree, on its test Postgres (.pgtest/data): the run records itself in
// .pgtest/run.json before it starts a server, and a second run there waits for the first, saying so once and naming it,
// rather than failing at the server's start (friction_f33f00f1da61) or being refused (friction_c4394d7c58fc).
// It waits only once it holds its own hold (test.mjs), so whoever holds run.json already holds theirs and waits on no one:
// a run waiting here never stalls the gate's own test step, which runs under the gate's hold.
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const TOKEN = randomUUID(); // tells this process's record from one a reused pid left

/**
 * Take the worktree's test run for this process, recorded as `what` (what it runs), waiting while another live run holds
 * it: `log` is told once whose run it waits for, and it looks again every `everyMs`. Resolves to `{ release }`, or to
 * `{ stopped: true }` when `stopped()` turns true while it waits. A record whose process has gone is stale and taken over.
 */
export async function takeWorktreeRun(work, { what, log = console.log, everyMs = 1000, stopped = () => false }) {
  mkdirSync(work, { recursive: true });
  const file = path.join(work, "run.json");
  const scratch = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(scratch, JSON.stringify({ pid: process.pid, token: TOKEN, what, startedAt: new Date().toISOString() }));
  let waitedFor; // the record of the run this one said it waits for
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        linkSync(scratch, file); // whole or not at all: no one reads half a record
        break;
      } catch (error) {
        if (error?.code !== "EEXIST" || attempt === 10) throw error;
      }
      const text = readText(file);
      const holder = parse(text);
      if (holder !== undefined && alive(holder)) {
        if (text !== waitedFor) {
          log(`waiting for another pnpm test (pid ${holder.pid}, ${holder.what}, started ${holder.startedAt}) in this worktree, which holds its test Postgres (${path.join(path.basename(work), "data")}); this run starts once it ends`);
          waitedFor = text;
        }
        await new Promise((resolve) => setTimeout(resolve, everyMs));
        if (stopped()) return { stopped: true };
        attempt = 0; // a live holder is waited for, not counted against the tries
        continue;
      }
      if (readText(file) === text) rmSync(file, { force: true }); // stale, unless replaced meanwhile
    }
  } finally {
    rmSync(scratch, { force: true });
  }
  const release = () => {
    process.off("exit", release);
    if (parse(readText(file))?.token === TOKEN) rmSync(file, { force: true });
  };
  process.on("exit", release); // a run that exits early (past its deadline) lets the worktree go too
  return { release };
}

/** What a run runs, for its record: the files named on its command line, relative to `root` with forward slashes on every platform, else its units. */
export function runWhat({ root, files, units }) {
  return files.length > 0 ? `files: ${files.map((file) => path.relative(root, path.resolve(file)).replaceAll("\\", "/")).join(", ")}` : `units: ${units.join(", ")}`;
}

function alive(holder) {
  if (holder.pid === process.pid) return holder.token === TOKEN;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM"; // alive, but not ours to signal
  }
}

function parse(text) {
  try {
    const record = JSON.parse(text);
    return Number.isInteger(record?.pid) ? record : undefined;
  } catch {
    return undefined;
  }
}

function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
