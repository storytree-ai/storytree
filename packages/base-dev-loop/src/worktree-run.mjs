// One live `pnpm test` at a time in a worktree, on its test Postgres (.pgtest/data): the run records itself in
// .pgtest/run.json before it waits for any hold or starts a server, and a second run there is refused at once, naming
// the first, rather than queueing behind the machine's lock to fail at the server's start (friction_f33f00f1da61).
// Refused, never queued: a run waiting here while the gate's own test step waits on it would wait for good.
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const TOKEN = randomUUID(); // tells this process's record from one a reused pid left

/**
 * Take the worktree's test run for this process, recorded as `what` (what it runs). Returns `{ release }`, or
 * `{ refusal }` naming the live run that holds it. A record whose process has gone is stale and taken over.
 */
export function takeWorktreeRun(work, { what }) {
  mkdirSync(work, { recursive: true });
  const file = path.join(work, "run.json");
  const scratch = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(scratch, JSON.stringify({ pid: process.pid, token: TOKEN, what, startedAt: new Date().toISOString() }));
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
        return { refusal: `another pnpm test (pid ${holder.pid}, ${holder.what}, started ${holder.startedAt}) is running in this worktree and holds its test Postgres (${path.join(path.basename(work), "data")}); this run is refused: wait for it to end, then run again` };
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

/** What a run runs, for its record: the files named on its command line, relative to `root`, else its units. */
export function runWhat({ root, files, units }) {
  return files.length > 0 ? `files: ${files.map((file) => path.relative(root, path.resolve(file))).join(", ")}` : `units: ${units.join(", ")}`;
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
