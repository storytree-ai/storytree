// Capability 3 · The pool runs its lanes under the machine's cap (ADR-0955 D2).
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

export const POOL_CODE = ["launch.mjs", "feed.mjs", "queue.mjs", "runner.mjs", "engine.mjs", "watch.mjs", "pool-config.mjs",
  "pool-brief.md", "pool-brief-plan.md", "pool-brief-read-only.md"].map((name) => `packages/agent-pool/src/${name}`);

export async function codeVersion({ repo, paths = POOL_CODE, config, live = [], exec = promisify(execFile) }) {
  const { stdout } = await exec("git", ["ls-tree", "HEAD", "--", ...paths], { cwd: repo });
  const configured = config ? settled(await readFile(config, "utf8").catch(() => ""), live) : "";
  return stdout.trim() ? createHash("sha1").update(stdout).update(configured).digest("hex").slice(0, 12) : undefined;
}

function settled(text, live) {
  if (!live.length) return text;
  try {
    const fields = JSON.parse(text);
    for (const name of live) delete fields[name];
    return JSON.stringify(fields);
  } catch { return text; }
}

const ENGINES = [["codex", "exec"], ["codex", "e"], ["claude", "-p"], ["claude", "--print"]];

const leadingWords = (args, count) => [...args.trim().matchAll(/"([^"]*)"|(\S+)/g)].slice(0, count).map((word) => word[1] ?? word[2]);

const programName = (path = "") => posix.basename(path.replace(/\\/g, "/")).replace(/\.(exe|cmd|js)$/i, "");

export function isEngine(args) {
  const words = leadingWords(args, 3);
  const start = /^node\d*$/i.test(programName(words[0])) ? 1 : 0;
  const name = programName(words[start]), verb = words[start + 1];
  return ENGINES.some(([engine, flag]) => name === engine && verb === flag);
}

export const WINDOWS_PROCESSES = ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
  "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"]];

export function processTable(json) {
  if (!json.trim()) return "";
  const listed = JSON.parse(json);
  return (Array.isArray(listed) ? listed : [listed]).filter((one) => one.CommandLine)
    .map((one) => `${one.ProcessId} ${one.ParentProcessId} ${String(one.CommandLine).replace(/\s+/g, " ").trim()}`).join("\n");
}

export function countEngines(table) {
  const rows = table.split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(\S.*|)$/.exec(line)).filter(Boolean)
    .map(([, pid, ppid, args]) => ({ pid, ppid, args }));
  const engines = new Set(rows.filter((row) => isEngine(row.args)).map((row) => row.pid));
  return rows.filter((row) => engines.has(row.pid) && !engines.has(row.ppid)).length;
}

export function runningLanes(table) {
  const ids = table.split("\n").map((line) => /^\s*\d+\s+\d+\s+(\S.*|)$/.exec(line)?.[1]).filter((args) => args && isEngine(args))
    .map((args) => /Your increment: (increment_[0-9a-f]+)/.exec(args)?.[1]).filter(Boolean);
  return [...new Set(ids)];
}

export async function waitForSlot({ max, count, sleep, onWait }) {
  let waited = false;
  for (;;) {
    const running = await count();
    if (running < (typeof max === "function" ? await max() : max)) return running;
    if (!waited) { onWait(running); waited = true; }
    await sleep(60_000);
  }
}

export const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
};

export async function withLockFile(path, fn, { pid = process.pid, alive = isAlive, sleep = (ms) => wait(ms), write = writeFile } = {}) {
  for (;;) {
    try { await write(path, `${pid}\n`, { flag: "wx" }); break; }
    catch (error) { if (error.code !== "EEXIST" && error.code !== "EPERM") throw error; }
    const holder = Number((await readFile(path, "utf8").catch(() => "")).trim());
    if (holder && !alive(holder)) { await rm(path, { force: true }); continue; }
    await sleep(1000);
  }
  try { return await fn(); }
  finally { await rm(path, { force: true }); }
}

export const ENGINE_SLOTS = "engine-slots";

export async function reserveSlot({ dir, max, count, sleep, onWait, pid = process.pid, alive = isAlive }) {
  await mkdir(dir, { recursive: true });
  let waited = false;
  for (;;) {
    const slot = await withLockFile(join(dir, "lock"), async () => {
      let reserved = 0;
      for (const name of (await readdir(dir)).filter((one) => one.endsWith(".slot"))) {
        if (alive(Number(name.split("-")[0]))) reserved++;
        else await rm(join(dir, name), { force: true });
      }
      const running = await count() + reserved;
      if (running >= (typeof max === "function" ? await max() : max)) return { running };
      const path = join(dir, `${pid}-${randomUUID()}.slot`);
      await writeFile(path, `${pid}\n`);
      return { running, release: () => rm(path, { force: true }).catch(() => {}) };
    }, { alive });
    if (slot.release) return slot;
    if (!waited) { onWait(slot.running); waited = true; }
    await sleep(60_000);
  }
}

export function localBrief(text, { checkout, lanes, pool } = {}) {
  let local = text;
  if (checkout) local = local.replaceAll("{checkout}", () => checkout);
  if (lanes) local = local.replaceAll("{lanes}", () => lanes);
  if (pool) local = local.replaceAll("{pool}", () => pool);
  return local;
}

export function composeBrief({ title, intro, notes = "", common }) {
  return [`# ${title}`, "", intro, "", ...(notes ? [notes.replace(/(?<!\n)\n*$/, ""), ""] : []), common].join("\n");
}

export async function holdRunner({ pidFile, pid = process.pid, marks, argsOf }) {
  const old = (await readFile(pidFile, "utf8").catch(() => "")).trim();
  if (old && old !== String(pid)) {
    const args = await argsOf(old);
    if (marks.some((mark) => mark.test(args))) return { held: false, by: old };
  }
  await writeFile(pidFile, `${pid}\n`);
  return { held: true };
}
