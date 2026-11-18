// Capability 2 · A server on a data directory
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
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
  readonly bin?: string;
  readonly account?: Account;
  readonly toolLog?: string;
  readonly log?: (message: string) => void;
}

export interface StartOptions extends ClusterOptions {
  readonly dataDir: string;
  readonly port?: number;
  readonly serverLog?: string;
  readonly owner?: string;
  readonly settings?: Readonly<Record<string, string>>;
  readonly signIn?: "client" | "superuser";
  readonly superuserUrl?: boolean;
}

export interface LocalPostgres {
  readonly url: string;
  readonly superuserUrl?: string;
  readonly port: number;
  readonly dataDir: string;
  stop(): Promise<void>;
}

export class DataDirInUseError extends Error {
  readonly dataDir: string;
  readonly pid: number;
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

interface OwnerRecord {
  pid: number;
  token: string;
  owner?: string;
  port: number;
  startedAt: string;
  auth: AuthMarker;
}

export interface Account {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
}

interface Tools {
  readonly bin: string;
  readonly toolLog: string;
  readonly account?: Account;
}

const UNPRIVILEGED = "nobody";

export function serverAccount(uid = process.getuid?.(), passwd?: string): Account | undefined {
  if (uid !== 0) return undefined;
  for (const line of (passwd ?? readText("/etc/passwd")).split("\n")) {
    const [name, , user, group] = line.split(":");
    if (name === UNPRIVILEGED && /^\d+$/.test(user ?? "") && /^\d+$/.test(group ?? "")) {
      return { name, uid: Number(user), gid: Number(group) };
    }
  }
  throw new Error(`Postgres will not run as root, and this machine has no account "${UNPRIVILEGED}" to run it as`);
}

export function letThrough(target: string, account: Account): void {
  let dir = path.dirname(path.resolve(target));
  for (;;) {
    const stat = lstatSync(dir);
    const searchable = stat.uid === account.uid ? stat.mode & 0o100 : stat.gid === account.gid ? stat.mode & 0o010 : stat.mode & 0o001;
    if (!searchable) chmodSync(dir, (stat.mode & 0o7777) | 0o001);
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function handOver(tools: Tools, file: string): void {
  if (tools.account !== undefined) chownSync(file, tools.account.uid, tools.account.gid);
}

const PROCESS_TOKEN = randomUUID();

const HBA = `# storytree: every connection signs in with a password (SCRAM), from this machine only
local   all           all                    scram-sha-256
host    all           all    127.0.0.1/32    scram-sha-256
host    all           all    ::1/128         scram-sha-256
local   replication   all                    scram-sha-256
host    replication   all    127.0.0.1/32    scram-sha-256
host    replication   all    ::1/128         scram-sha-256
`;

const SIGN_IN_MARKER = "storytree-sign-in";

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
  const pwDir = tools.account === undefined ? authDir(dir) : `${dir}.initdb-pw`;
  if (tools.account !== undefined) {
    letThrough(scratch, tools.account);
    mkdirSync(scratch, { mode: 0o700 });
    handOver(tools, scratch);
    rmSync(pwDir, { recursive: true, force: true });
    mkdirSync(pwDir, { mode: 0o700 });
    handOver(tools, pwDir);
  }
  const pwfile = writePrivate(pwDir, scramVerifier(installation.password));
  try {
    handOver(tools, pwfile);
    const code = await tool(tools, "initdb", ["-D", scratch, "-U", "postgres", "-A", "scram-sha-256", `--pwfile=${pwfile}`, "-E", "UTF8"]);
    if (code !== 0) throw new Error(`initdb failed with exit code ${code}; see ${tools.toolLog}`);
  } finally {
    rmSync(tools.account === undefined ? pwfile : pwDir, { recursive: true, force: true });
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
    if (tools.account !== undefined) {
      letThrough(serverLog, tools.account);
      closeSync(openSync(serverLog, "a"));
      handOver(tools, serverLog);
    }
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
    ...(options.superuserUrl === true ? { superuserUrl: connectionUrl(installation, port) } : {}),
    port,
    dataDir,
    stop() {
      stopping ??= stopServer(dataDir, tools, log).then(
        () => release(dataDir),
        (error: unknown) => {
          stopping = undefined;
          throw error;
        },
      );
      return stopping;
    },
  };
}

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
  handOver(tools, hba);
  replaceFile(marker, installation.installationId);
}

async function singleUser(dataDir: string, tools: Tools, input: string): Promise<number> {
  if (process.platform !== "win32") return tool(tools, "postgres", ["--single", "-D", dataDir, "postgres"], input);
  const dir = authDir(dataDir);
  const inputFile = writePrivate(dir, input);
  const written = writePrivate(dir, SINGLE_USER_SCRIPT);
  const script = `${written}.cmd`;
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

function singleUserLog(dataDir: string): string {
  return `${dataDir}.single-user.log`;
}

const SINGLE_USER_SCRIPT = [
  "@echo off",
  '"%STORYTREE_SINGLE_POSTGRES%" --single -D "%STORYTREE_SINGLE_DATA%" postgres < "%STORYTREE_SINGLE_INPUT%"',
  '>"%STORYTREE_SINGLE_EXIT%.tmp" echo %ERRORLEVEL%',
  'move /y "%STORYTREE_SINGLE_EXIT%.tmp" "%STORYTREE_SINGLE_EXIT%" >nul',
  "",
].join("\r\n");

async function provisionClient(installation: Installation, client: SignIn, port: number, log: (message: string) => void): Promise<void> {
  const role = quoteIdentifier(client.user);
  const handOver: string[] = await withClient(connectionUrl(installation, port), async (admin) => {
    const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [client.user])).rows.length > 0;
    const invalid = (await admin.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datconnlimit = -2 ORDER BY datname")).rows.map((row) => row.datname);
    if (invalid.length > 0) log(`dropping ${invalid.length === 1 ? "a database" : "databases"} an interrupted run left invalid: ${invalid.join(", ")}`);
    for (const database of invalid) await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
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

function lacksPassword(line: string): boolean {
  const words = line.replace(/#.*/, "").trim().split(/\s+/).filter((word) => word !== "");
  return words.length > 0 && !words.includes("scram-sha-256") && !words.includes("reject");
}

function replaceFile(file: string, text: string): void {
  const scratch = `${file}.${process.pid}.${randomUUID()}`;
  writeFileSync(scratch, text, { mode: 0o600 });
  renameSync(scratch, file);
}

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

export interface PgCtlOptions extends ClusterOptions {
  readonly timeoutMs?: number;
}

export function pgCtl(dataDir: string, args: readonly string[], options: PgCtlOptions = {}): Promise<number> {
  const dir = path.resolve(dataDir);
  const tools = toolsFor(dir, options);
  if (tools.account !== undefined) letThrough(dir, tools.account);
  return tool(tools, "pg_ctl", ["-D", dir, ...args], undefined, undefined, options.timeoutMs);
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

function isOwnerAlive(record: OwnerRecord): boolean {
  if (record.pid === process.pid) return record.token === PROCESS_TOKEN;
  try {
    process.kill(record.pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

function toolsFor(dataDir: string, options: ClusterOptions): Tools {
  const bin = options.bin ?? findBinaries();
  const account = options.account ?? serverAccount();
  if (account !== undefined) letThrough(path.join(bin, "postgres"), account);
  return { bin, toolLog: options.toolLog ?? `${dataDir}.tools.log`, ...(account === undefined ? {} : { account }) };
}

function tool(
  tools: Tools,
  name: string,
  args: readonly string[],
  input?: string,
  env?: Readonly<Record<string, string>>,
  timeoutMs?: number,
): Promise<number> {
  mkdirSync(path.dirname(tools.toolLog), { recursive: true });
  const out = openSync(tools.toolLog, "a");
  writeSync(out, `\n[${new Date().toISOString()}] ${name} ${args.join(" ")}\n`);
  const executable = path.join(tools.bin, process.platform === "win32" ? `${name}.exe` : name);
  return new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: [input === undefined ? "ignore" : "pipe", out, out],
      windowsHide: true,
      ...(tools.account === undefined ? {} : { uid: tools.account.uid, gid: tools.account.gid }),
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
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
