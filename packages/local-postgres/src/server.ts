/**
 * Capability 2 · A server on a data directory. One local Postgres server on a data directory, as storytree runs it: the cluster is made with
 * initdb the first time, trusts local connections and listens on 127.0.0.1 only, and the server
 * runs on a free port unless one is asked for.
 *
 * A data directory has at most one owner: the process that started its server and has not yet
 * stopped it. start() records the owner beside the directory (`<dataDir>.owner.json`), and stop()
 * removes the record. While the recorded process is alive, a start is refused with a
 * DataDirInUseError naming it. A record whose process has died is stale: the server it left
 * running is stopped and the record cleared, and the start goes ahead.
 *
 * On Windows the tools' output always goes to a log file, never to a pipe: `pg_ctl start` leaves a
 * shell holding its output handles for as long as the server runs, so a pipe would never close.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { findBinaries } from "./binaries.js";

export interface ClusterOptions {
  /** The directory holding initdb, pg_ctl and postgres. By default, findBinaries(). */
  readonly bin?: string;
  /** Where the Postgres tools' output is appended. By default, `<dataDir>.tools.log`. */
  readonly toolLog?: string;
  /** Called with each step worth telling a person about. */
  readonly log?: (message: string) => void;
}

export interface StartOptions extends ClusterOptions {
  /** The cluster's directory. It is made (initdb) if there is none. */
  readonly dataDir: string;
  /** The port to listen on, on 127.0.0.1. By default, a free one. */
  readonly port?: number;
  /** Where the server writes its log. By default, `<dataDir>.log`. */
  readonly serverLog?: string;
  /** Who is starting it, as a refusal names the holder to someone else. */
  readonly owner?: string;
}

/** A running server. */
export interface LocalPostgres {
  /** postgres://postgres@127.0.0.1:<port>/postgres */
  readonly url: string;
  readonly port: number;
  /** The data directory, as an absolute path. */
  readonly dataDir: string;
  /** Stop the server and give up the data directory. Stopping it again is harmless. */
  stop(): Promise<void>;
}

/** A start refused because a live process holds the data directory. */
export class DataDirInUseError extends Error {
  /** The data directory, as an absolute path. */
  readonly dataDir: string;
  /** The process holding it. */
  readonly pid: number;
  /** Who that process said it was, when it said. */
  readonly owner: string | undefined;

  constructor(dataDir: string, pid: number, owner?: string) {
    super(
      `the Postgres data directory ${dataDir} is in use by process ${pid}` +
        `${owner === undefined ? "" : ` (${owner})`}: stop that, then try again`,
    );
    this.name = "DataDirInUseError";
    this.dataDir = dataDir;
    this.pid = pid;
    this.owner = owner;
  }
}

/** The owner record kept beside a data directory while its server runs. */
interface OwnerRecord {
  pid: number;
  /** Tells this process's records from those of an earlier process that had the same pid. */
  token: string;
  owner?: string;
  port: number;
  startedAt: string;
}

/** Where the tools are and where their output goes. */
interface Tools {
  readonly bin: string;
  readonly toolLog: string;
}

/** This process's token: a record carrying it was written by this very process. */
const PROCESS_TOKEN = randomUUID();

/**
 * Make the cluster in `dataDir` unless there is one: initdb as user `postgres`, trusting local
 * connections, UTF8, set to listen on 127.0.0.1 only. The cluster is made in a scratch directory
 * and renamed into place once complete, so an interrupted first run never leaves half a cluster.
 * True if it was made now. A directory that holds something other than a cluster is refused.
 */
export async function ensureCluster(dataDir: string, options: ClusterOptions = {}): Promise<boolean> {
  const dir = path.resolve(dataDir);
  if (existsSync(path.join(dir, "PG_VERSION"))) return false;
  if (existsSync(dir)) {
    if (readdirSync(dir).length > 0) {
      throw new Error(`${dir} is not a Postgres data directory and is not empty, so no cluster will be made there`);
    }
    rmdirSync(dir);
  }
  const tools = toolsFor(dir, options);
  const log = options.log ?? (() => {});
  mkdirSync(path.dirname(dir), { recursive: true });
  const scratch = `${dir}.initdb`;
  rmSync(scratch, { recursive: true, force: true });
  log(`creating the cluster in ${dir} (first run only; it can take minutes under x64 emulation)`);
  const started = Date.now();
  const code = await tool(tools, "initdb", ["-D", scratch, "-U", "postgres", "-A", "trust", "-E", "UTF8"]);
  if (code !== 0) throw new Error(`initdb failed with exit code ${code}; see ${tools.toolLog}`);
  appendFileSync(
    path.join(scratch, "postgresql.conf"),
    "\n# storytree: this server is for this machine only\nlisten_addresses = '127.0.0.1'\n",
  );
  await renameIntoPlace(scratch, dir);
  log(`cluster created in ${since(started)}`);
  return true;
}

/**
 * Start the server on `options.dataDir`, making the cluster first if there is none. Refused with a
 * DataDirInUseError while a live process holds the directory; a server left running by a process
 * that has died is stopped first. The server listens on 127.0.0.1 only.
 */
export async function start(options: StartOptions): Promise<LocalPostgres> {
  const dataDir = path.resolve(options.dataDir);
  const tools = toolsFor(dataDir, options);
  const serverLog = options.serverLog ?? `${dataDir}.log`;
  const log = options.log ?? (() => {});
  const port = options.port ?? (await freePort());

  mkdirSync(path.dirname(dataDir), { recursive: true });
  const record: OwnerRecord = {
    pid: process.pid,
    token: PROCESS_TOKEN,
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    port,
    startedAt: new Date().toISOString(),
  };
  await claim(dataDir, record, tools, log);
  try {
    await ensureCluster(dataDir, { ...tools, log });
    mkdirSync(path.dirname(serverLog), { recursive: true });
    const started = Date.now();
    const code = await tool(tools, "pg_ctl", [
      "-D", dataDir,
      "-o", `-p ${port} -c listen_addresses=127.0.0.1`,
      "-l", serverLog,
      "-w", "start",
    ]);
    if (code !== 0) throw new Error(`pg_ctl start failed with exit code ${code}; see ${serverLog} and ${tools.toolLog}`);
    log(`listening on 127.0.0.1:${port} (started in ${since(started)})`);
  } catch (error) {
    release(dataDir);
    throw error;
  }

  let stopping: Promise<void> | undefined;
  return {
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    port,
    dataDir,
    stop() {
      stopping ??= stopServer(dataDir, tools, log).then(
        () => release(dataDir),
        (error: unknown) => {
          stopping = undefined; // it may be tried again
          throw error;
        },
      );
      return stopping;
    },
  };
}

/**
 * Record this process as the data directory's owner. The record is created whole or not at all
 * (a hard link to a complete file), so no one ever reads half of one. A record already there
 * whose process is alive refuses the start; one whose process is gone is stale and cleared. Once
 * this process owns the directory, a server still running there has no live owner, so it is
 * stopped.
 */
async function claim(dataDir: string, record: OwnerRecord, tools: Tools, log: (message: string) => void): Promise<void> {
  const file = ownerFile(dataDir);
  const scratch = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(scratch, JSON.stringify(record));
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        linkSync(scratch, file);
        break;
      } catch (error) {
        if (!isCode(error, "EEXIST") || attempt === 10) throw error;
      }
      const text = readText(file);
      const holder = parseRecord(text);
      if (holder !== undefined && isOwnerAlive(holder)) throw new DataDirInUseError(dataDir, holder.pid, holder.owner);
      // Stale: its process is gone. Clear it, unless someone replaced it meanwhile.
      if (readText(file) === text) rmSync(file, { force: true });
    }
  } finally {
    rmSync(scratch, { force: true });
  }
  try {
    if (await isRunning(dataDir, tools)) {
      log("stopping a server left running by a process that has since stopped");
      await stopServer(dataDir, tools, log);
    }
  } catch (error) {
    release(dataDir);
    throw error;
  }
}

/** Remove this process's owner record for `dataDir`. Anyone else's is left alone. */
function release(dataDir: string): void {
  const file = ownerFile(dataDir);
  const holder = parseRecord(readText(file));
  if (holder?.pid === process.pid && holder.token === PROCESS_TOKEN) rmSync(file, { force: true });
}

async function stopServer(dataDir: string, tools: Tools, log: (message: string) => void): Promise<void> {
  if (!(await isRunning(dataDir, tools))) {
    log("not running");
    return;
  }
  const started = Date.now();
  let code = await tool(tools, "pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
  if (code !== 0 && (await isRunning(dataDir, tools))) {
    code = await tool(tools, "pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
  }
  if (code !== 0 && (await isRunning(dataDir, tools))) {
    throw new Error(`pg_ctl stop failed with exit code ${code}; the server on ${dataDir} may still be running (see ${tools.toolLog})`);
  }
  log(`stopped (${since(started)})`);
}

async function isRunning(dataDir: string, tools: Tools): Promise<boolean> {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) return false;
  return (await tool(tools, "pg_ctl", ["-D", dataDir, "status"])) === 0;
}

function ownerFile(dataDir: string): string {
  return `${dataDir}.owner.json`;
}

function parseRecord(text: string): OwnerRecord | undefined {
  try {
    const value = JSON.parse(text) as Partial<OwnerRecord> | null;
    if (typeof value?.pid !== "number" || typeof value.token !== "string") return undefined;
    return value as OwnerRecord;
  } catch {
    return undefined;
  }
}

/** Whether the process that wrote `record` is still running. Our own pid counts only for records this process wrote. */
function isOwnerAlive(record: OwnerRecord): boolean {
  if (record.pid === process.pid) return record.token === PROCESS_TOKEN;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM"); // alive, but not ours to signal
  }
}

function toolsFor(dataDir: string, options: ClusterOptions): Tools {
  return { bin: options.bin ?? findBinaries(), toolLog: options.toolLog ?? `${dataDir}.tools.log` };
}

/** Run one Postgres tool to completion, appending its output to the tool log. Resolves to its exit code. */
function tool(tools: Tools, name: string, args: readonly string[]): Promise<number> {
  mkdirSync(path.dirname(tools.toolLog), { recursive: true });
  const out = openSync(tools.toolLog, "a");
  writeSync(out, `\n[${new Date().toISOString()}] ${name} ${args.join(" ")}\n`);
  const executable = path.join(tools.bin, process.platform === "win32" ? `${name}.exe` : name);
  return new Promise<number>((resolve, reject) => {
    // windowsHide: started from a GUI app, the tools and the server get a hidden console, not a window.
    const child = spawn(executable, args, { stdio: ["ignore", out, out], windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  }).finally(() => closeSync(out));
}

async function renameIntoPlace(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      // Windows can keep a just-written file open for a moment (a virus scan, the indexer).
      if (attempt === 20 || !(isCode(error, "EPERM") || isCode(error, "EBUSY") || isCode(error, "EACCES"))) throw error;
      await sleep(250);
    }
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address !== null) resolve(address.port);
        else reject(new Error("could not find a free port"));
      });
    });
  });
}

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function since(started: number): string {
  return `${((Date.now() - started) / 1000).toFixed(1)} s`;
}
