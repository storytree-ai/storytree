// Capability 4 · Running the tests
import { randomUUID } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const TOKEN = randomUUID();

export async function takeWorktreeRun(work, { what, log = console.log, everyMs = 1000, stopped = () => false }) {
  mkdirSync(work, { recursive: true });
  const file = path.join(work, "run.json");
  const scratch = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(scratch, JSON.stringify({ pid: process.pid, token: TOKEN, what, startedAt: new Date().toISOString() }));
  let waitedFor;
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        linkSync(scratch, file);
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
        attempt = 0;
        continue;
      }
      if (readText(file) === text) rmSync(file, { force: true });
    }
  } finally {
    rmSync(scratch, { force: true });
  }
  const release = () => {
    process.off("exit", release);
    if (parse(readText(file))?.token === TOKEN) rmSync(file, { force: true });
  };
  process.on("exit", release);
  return { release };
}

export function runWhat({ root, files, units }) {
  return files.length > 0 ? `files: ${files.map((file) => path.relative(root, path.resolve(file)).replaceAll("\\", "/")).join(", ")}` : `units: ${units.join(", ")}`;
}

function alive(holder) {
  if (holder.pid === process.pid) return holder.token === TOKEN;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
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
