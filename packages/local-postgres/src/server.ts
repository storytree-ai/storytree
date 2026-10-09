/**
 * Capability 2 · A server on a data directory. One local Postgres server on a data directory, as storytree runs it: the cluster is made with
 * initdb the first time, asks every connection for the installation's password (SCRAM, see
 * auth.ts) and listens on 127.0.0.1 only, and the server runs on a free port unless one is asked
 * for. A cluster made when local connections were trusted is given the password and its trust
 * taken away before its server next starts, with no network open while that happens.
 *
 * Clients sign in as an ordinary role, never the superuser (ADR-0948): once the server listens, and
 * before any client is handed a way in, start() makes sure the role `storytree` exists with its
 * password, may create databases and nothing more, and owns every database in the cluster (but the
 * two templates), with everything in them. A cluster from before this, whose databases and tables
 * are the superuser's, is handed over then; each database is given away last, so an interrupted
 * start does it again.
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

import pg from "pg";

import {
  authDir,
  authMarker,
  connectionUrl,
  ensureClientSignIn,
  ensureInstallation,
  publishConnection,
  scramVerifier,
  withdrawConnection,
  writePrivate,
  type AuthMarker,
  type Installation,
  type SignIn,
} from "./auth.js";
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
  /**
   * Server settings for this run only (`-c name=value`), each value one plain word. A throwaway
   * test server is started with fsync, synchronous_commit and full_page_writes off; the app's own
   * server never is.
   */
  readonly settings?: Readonly<Record<string, string>>;
  /**
   * Whom the url and the handoff sign in as: the ordinary role `storytree` (by default), or the
   * superuser, for a throwaway test server whose tests make roles of their own. The app's own
   * server never hands out the superuser.
   */
  readonly signIn?: "client" | "superuser";
}

/** A running server. */
export interface LocalPostgres {
  /**
   * postgres://storytree:<password>@127.0.0.1:<port>/postgres (postgres:… when started with
   * signIn "superuser"), which carries the installation's secret: connect with it, never show or
   * log it.
   */
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
  /** A client signs in through the private handoff this names (ADR-0941). */
  auth: AuthMarker;
}

/** Where the tools are and where their output goes. */
interface Tools {
  readonly bin: string;
  readonly toolLog: string;
}

/** This process's token: a record carrying it was written by this very process. */
const PROCESS_TOKEN = randomUUID();

/** Every storytree cluster's pg_hba.conf: a password, from this machine only, for everyone. */
const HBA = `# storytree: every connection signs in with a password (SCRAM), from this machine only
local   all           all                    scram-sha-256
host    all           all    127.0.0.1/32    scram-sha-256
host    all           all    ::1/128         scram-sha-256
local   replication   all                    scram-sha-256
host    replication   all    127.0.0.1/32    scram-sha-256
host    replication   all    ::1/128         scram-sha-256
`;

/** In the data directory, the installation whose password the cluster holds. */
const SIGN_IN_MARKER = "storytree-sign-in";

/**
 * Make the cluster in `dataDir` unless there is one: initdb as user `postgres`, with the
 * installation's password, signing in by password only, UTF8, set to listen on 127.0.0.1 only. The cluster is made in a scratch directory
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
  const installation = ensureInstallation(dir);
  // initdb is given the password's verifier, never the password itself.
  const pwfile = writePrivate(authDir(dir), scramVerifier(installation.password));
  try {
    const code = await tool(tools, "initdb", ["-D", scratch, "-U", "postgres", "-A", "scram-sha-256", `--pwfile=${pwfile}`, "-E", "UTF8"]);
    if (code !== 0) throw new Error(`initdb failed with exit code ${code}; see ${tools.toolLog}`);
  } finally {
    rmSync(pwfile, { force: true });
  }
  appendFileSync(
    path.join(scratch, "postgresql.conf"),
    "\n# storytree: this server is for this machine only\nlisten_addresses = '127.0.0.1'\n",
  );
  writeFileSync(path.join(scratch, "pg_hba.conf"), HBA);
  writeFileSync(path.join(scratch, SIGN_IN_MARKER), installation.installationId);
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
  const settings = Object.entries(options.settings ?? {}).map(([name, value]) => {
    if (!/^[a-z_][a-z0-9_.]*$/.test(name) || !/^[\w.:-]+$/.test(value)) {
      throw new Error(`the server setting ${name}=${JSON.stringify(value)} is not a plain name and one plain word`);
    }
    return ` -c ${name}=${value}`;
  });

  mkdirSync(path.dirname(dataDir), { recursive: true });
  const installation = ensureInstallation(dataDir);
  const client = ensureClientSignIn(dataDir);
  const signIn = options.signIn === "superuser" ? installation : client;
  const record: OwnerRecord = {
    pid: process.pid,
    token: PROCESS_TOKEN,
    ...(options.owner === undefined ? {} : { owner: options.owner }),
    port,
    startedAt: new Date().toISOString(),
    auth: authMarker(installation),
  };
  await claim(dataDir, record, tools, log);
  try {
    const made = await ensureCluster(dataDir, { ...tools, log });
    if (!made) await requirePasswords(dataDir, installation, tools, log);
    mkdirSync(path.dirname(serverLog), { recursive: true });
    const started = Date.now();
    const code = await tool(tools, "pg_ctl", [
      "-D", dataDir,
      "-o", `-p ${port} -c listen_addresses=127.0.0.1${settings.join("")}`,
      "-l", serverLog,
      "-w", "start",
    ]);
    if (code !== 0) throw new Error(`pg_ctl start failed with exit code ${code}; see ${serverLog} and ${tools.toolLog}`);
    log(`listening on 127.0.0.1:${port} (started in ${since(started)})`);
    try {
      await provisionClient(installation, client, port, log);
    } catch (error) {
      await stopServer(dataDir, tools, log).catch(() => {});
      throw error;
    }
    publishConnection(dataDir, installation, signIn, PROCESS_TOKEN, port);
  } catch (error) {
    release(dataDir);
    throw error;
  }

  let stopping: Promise<void> | undefined;
  return {
    url: connectionUrl(signIn, port),
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

/**
 * Make an existing cluster ask for the installation's password, unless it already does. A cluster
 * whose password is another installation's, or none (one made when local connections were
 * trusted), is given this one's in single-user mode (singleUser()), which opens no connection at all; then its
 * pg_hba.conf is replaced, and the marker naming the installation written last. Interrupted at any
 * step, the next start does it again; the server is never started before all of it is done. A
 * pg_hba.conf line that lets anyone in without a password is replaced in the same way.
 */
async function requirePasswords(dataDir: string, installation: Installation, tools: Tools, log: (message: string) => void): Promise<void> {
  const marker = path.join(dataDir, SIGN_IN_MARKER);
  const hba = path.join(dataDir, "pg_hba.conf");
  const signedIn = readText(marker) === installation.installationId;
  if (signedIn && !readText(hba).split("\n").some(lacksPassword)) return;
  if (!signedIn) {
    log("giving the cluster this installation's password");
    const input = `ALTER ROLE ${installation.user} WITH PASSWORD '${scramVerifier(installation.password)}';\n`;
    const code = await singleUser(dataDir, tools, input);
    if (code !== 0) {
      throw new Error(
        `could not give the Postgres cluster in ${dataDir} its password (exit code ${code}; see ${tools.toolLog}` +
          (process.platform === "win32" ? ` and ${singleUserLog(dataDir)})` : ")"),
      );
    }
  }
  log("signing in by password only");
  replaceFile(hba, HBA);
  replaceFile(marker, installation.installationId);
}

/**
 * Run `input` through the cluster's server in single-user mode, which opens no connection at all.
 * Resolves to its exit code.
 *
 * Postgres will not run for a Windows user with administrator rights, and single-user mode has
 * no way to give them up, so on Windows pg_ctl starts it: pg_ctl starts what it runs with those
 * rights taken out of its token, whoever runs pg_ctl. What it is given to run (`-p`) is a script
 * in the private sign-in directory that runs single-user mode on the input and writes down its
 * exit code; pg_ctl hands back at once (`-W`), so that exit code is waited for.
 */
async function singleUser(dataDir: string, tools: Tools, input: string): Promise<number> {
  if (process.platform !== "win32") return tool(tools, "postgres", ["--single", "-D", dataDir, "postgres"], input);
  const dir = authDir(dataDir);
  const inputFile = writePrivate(dir, input);
  const written = writePrivate(dir, SINGLE_USER_SCRIPT);
  const script = `${written}.cmd`; // cmd runs a script by its extension
  renameSync(written, script);
  const exitFile = `${inputFile}.exit`;
  try {
    const code = await tool(tools, "pg_ctl", ["-D", dataDir, "-p", script, "-l", singleUserLog(dataDir), "-W", "start"], undefined, {
      STORYTREE_SINGLE_POSTGRES: path.join(tools.bin, "postgres.exe"),
      STORYTREE_SINGLE_DATA: dataDir,
      STORYTREE_SINGLE_INPUT: inputFile,
      STORYTREE_SINGLE_EXIT: exitFile,
    });
    if (code !== 0) return code;
    const deadline = Date.now() + 10 * 60_000;
    for (;;) {
      const exitCode = readText(exitFile).trim();
      if (/^\d+$/.test(exitCode)) return Number(exitCode);
      if (Date.now() > deadline) throw new Error(`single-user mode on ${dataDir} did not finish in ten minutes; see ${singleUserLog(dataDir)}`);
      await sleep(100);
    }
  } finally {
    for (const file of [inputFile, script, exitFile, `${exitFile}.tmp`]) rmSync(file, { force: true });
  }
}

/** Where single-user mode's output goes on Windows. */
function singleUserLog(dataDir: string): string {
  return `${dataDir}.single-user.log`;
}

/**
 * The script pg_ctl runs for singleUser() on Windows, given everything by its environment. Its
 * exit code is written beside, then renamed into place, so it is never read half written.
 */
const SINGLE_USER_SCRIPT = [
  "@echo off",
  '"%STORYTREE_SINGLE_POSTGRES%" --single -D "%STORYTREE_SINGLE_DATA%" postgres < "%STORYTREE_SINGLE_INPUT%"',
  '>"%STORYTREE_SINGLE_EXIT%.tmp" echo %ERRORLEVEL%',
  'move /y "%STORYTREE_SINGLE_EXIT%.tmp" "%STORYTREE_SINGLE_EXIT%" >nul',
  "",
].join("\r\n");

/**
 * Make the ordinary role clients sign in as, signed in as the superuser: it exists, logs in with
 * `client`'s password, may create databases, and is no superuser, makes no roles, replicates
 * nothing and bypasses no row security, whatever it was before. Then every database not yet its
 * own (the templates aside) is handed to it, with the schemas, tables, views, sequences,
 * functions and types in it that are the superuser's; the database itself goes last.
 */
async function provisionClient(installation: Installation, client: SignIn, port: number, log: (message: string) => void): Promise<void> {
  const role = quoteIdentifier(client.user);
  const handOver: string[] = await withClient(connectionUrl(installation, port), async (admin) => {
    const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [client.user])).rows.length > 0;
    if (!exists) log(`making the role ${client.user}, which clients sign in as`);
    await admin.query(`${exists ? "ALTER" : "CREATE"} ROLE ${role} WITH LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS ` +
      `PASSWORD '${scramVerifier(client.password)}'`);
    const { rows } = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn AND datdba <> (SELECT oid FROM pg_roles WHERE rolname = $1) ORDER BY datname",
      [client.user],
    );
    return rows.map((row) => row.datname);
  });
  for (const database of handOver) {
    log(`handing the database ${database} to ${client.user}`);
    await withClient(connectionUrl(installation, port, database), async (admin) => {
      await admin.query(handOverObjects(role));
      await admin.query(`ALTER DATABASE ${quoteIdentifier(database)} OWNER TO ${role}`);
    });
  }
}

/**
 * Give `role` what the superuser owns in the connected database, outside the system's own
 * schemas. A table takes its indexes, its column sequences and its row type with it, so sequences
 * and types are looked for after the tables.
 */
function handOverObjects(role: string): string {
  const user = "(SELECT oid FROM pg_roles WHERE rolname = current_user)";
  const ours = (namespace: string): string => `${namespace} IN (SELECT oid FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\_%')`;
  return `DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT nspname FROM pg_namespace WHERE nspowner = ${user} AND ${ours("oid")} LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO ${role}', item.nspname);
  END LOOP;
  FOR item IN SELECT oid::regclass AS name, relkind FROM pg_class WHERE relowner = ${user} AND relkind IN ('r', 'p', 'f', 'v', 'm') AND ${ours("relnamespace")} LOOP
    EXECUTE format('ALTER %s %s OWNER TO ${role}',
      CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, item.name);
  END LOOP;
  FOR item IN SELECT oid::regclass AS name FROM pg_class WHERE relowner = ${user} AND relkind = 'S' AND ${ours("relnamespace")} LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO ${role}', item.name);
  END LOOP;
  FOR item IN SELECT oid::regprocedure AS name FROM pg_proc WHERE proowner = ${user} AND ${ours("pronamespace")} LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO ${role}', item.name);
  END LOOP;
  FOR item IN SELECT oid::regtype AS name, typtype FROM pg_type
      WHERE typowner = ${user} AND ${ours("typnamespace")} AND typtype IN ('c', 'd', 'e', 'r')
        AND (typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = typrelid) = 'c') LOOP
    EXECUTE format('ALTER %s %s OWNER TO ${role}', CASE item.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, item.name);
  END LOOP;
END $$`;
}

async function withClient<T>(url: string, use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
  await client.connect();
  try {
    return await use(client);
  } finally {
    await client.end();
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** A pg_hba.conf line that lets a connection in without the password (or includes rules unseen). */
function lacksPassword(line: string): boolean {
  const words = line.replace(/#.*/, "").trim().split(/\s+/).filter((word) => word !== "");
  return words.length > 0 && !words.includes("scram-sha-256") && !words.includes("reject");
}

/** Replace `file` with `text` whole: written beside it, then renamed over it. */
function replaceFile(file: string, text: string): void {
  const scratch = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(scratch, text, { mode: 0o600 });
  renameSync(scratch, file);
}

/** Withdraw this process's connection handoff and remove its owner record for `dataDir`. Anyone else's are left alone. */
function release(dataDir: string): void {
  withdrawConnection(dataDir, PROCESS_TOKEN);
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
function tool(tools: Tools, name: string, args: readonly string[], input?: string, env?: Readonly<Record<string, string>>): Promise<number> {
  mkdirSync(path.dirname(tools.toolLog), { recursive: true });
  const out = openSync(tools.toolLog, "a");
  writeSync(out, `\n[${new Date().toISOString()}] ${name} ${args.join(" ")}\n`);
  const executable = path.join(tools.bin, process.platform === "win32" ? `${name}.exe` : name);
  return new Promise<number>((resolve, reject) => {
    // windowsHide: started from a GUI app, the tools and the server get a hidden console, not a window.
    const child = spawn(executable, args, {
      stdio: [input === undefined ? "ignore" : "pipe", out, out],
      windowsHide: true,
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
    child.on("error", reject);
    child.stdin?.end(input);
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
