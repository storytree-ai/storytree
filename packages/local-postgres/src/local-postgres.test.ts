/**
 * local-postgres: one local Postgres server on a data directory, from the @embedded-postgres
 * binaries. These tests run real servers, each on a data directory of its own under the OS temp
 * directory, and stop every server they start, pass or fail.
 *
 * "A live process holds the data directory" is played by a real second process
 * (testing/holder.ts): started, it runs the server and holds it; killed, it leaves the server
 * running with no live owner, which is the stale case start() recovers from.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { ensureClientSignIn } from "./auth.js";
import { binaryPackages, DataDirInUseError, ensureCluster, findBinaries, start, type LocalPostgres } from "./index.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const holderScript = fileURLToPath(new URL("./testing/holder.ts", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "storytree-local-postgres-"));
const exe = (tool: string): string => (process.platform === "win32" ? `${tool}.exe` : tool);

/** Every server and holder a test started, stopped at the end whatever happened. */
const servers = new Set<LocalPostgres>();
const holders = new Set<ChildProcess>();

after(async () => {
  for (const holder of holders) holder.kill();
  for (const server of servers) await server.stop().catch(() => {});
  // A killed holder's server outlives it; stop whatever is still running on any data directory.
  for (const entry of readdirSync(root)) {
    const dataDir = path.join(root, entry);
    if (existsSync(path.join(dataDir, "PG_VERSION")) && serverRunning(dataDir)) pgCtl(["-D", dataDir, "-m", "immediate", "-w", "stop"]);
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

test("1.1, 1.2 the binaries come from this machine's @embedded-postgres package, and on Windows arm64 from the x64 one, run under emulation", () => {
  assert.deepEqual(binaryPackages("win32", "arm64"), ["@embedded-postgres/windows-arm64", "@embedded-postgres/windows-x64"]);
  assert.deepEqual(binaryPackages("win32", "x64"), ["@embedded-postgres/windows-x64"]);
  assert.deepEqual(binaryPackages("linux", "arm64"), ["@embedded-postgres/linux-arm64"]);
  assert.deepEqual(binaryPackages("darwin", "x64"), ["@embedded-postgres/darwin-x64"]);

  const bin = findBinaries();
  for (const tool of ["initdb", "pg_ctl", "postgres"]) {
    assert.ok(existsSync(path.join(bin, exe(tool))), `${tool} is in ${bin}`);
  }
  if (process.platform === "win32" && process.arch === "arm64") {
    assert.match(bin, /windows-x64/, "there is no windows-arm64 build, so the x64 one is used");
  }

  // With no package for the machine, the error names every package it looked for.
  assert.throws(() => findBinaries({ platform: "aix", arch: "ppc64" }), /@embedded-postgres\/aix-ppc64/);

  // A packaged app hands over the directory it ships the binaries in. One without them is refused, naming it.
  assert.equal(findBinaries({ dir: bin }), bin);
  const empty = path.join(root, "no-binaries");
  mkdirSync(empty);
  assert.throws(() => findBinaries({ dir: empty }), (error: Error) => error.message.includes(empty));
});

test("2.1 ensureCluster makes a cluster only when there is none: asking every connection for the installation's password, and listening on 127.0.0.1 only", async () => {
  const dataDir = path.join(root, "made");
  assert.equal(await ensureCluster(dataDir), true, "made the first time");
  assert.ok(existsSync(path.join(dataDir, "PG_VERSION")), "a Postgres cluster");
  assert.equal(existsSync(`${dataDir}.initdb`), false, "no scratch directory is left behind");
  assert.match(readFileSync(path.join(dataDir, "postgresql.conf"), "utf8"), /^listen_addresses = '127\.0\.0\.1'/m);
  const hba = readFileSync(path.join(dataDir, "pg_hba.conf"), "utf8");
  assert.match(hba, /^host\s+all\s+all\s+127\.0\.0\.1\/32\s+scram-sha-256\s*$/m);
  assert.doesNotMatch(hba, /trust/, "no connection is let in without the password");
  assert.ok(existsSync(path.join(`${dataDir}.auth`, "installation.json")), "the password is kept beside it, privately");
  assert.equal(await ensureCluster(dataDir), false, "left as it is the second time");

  // A directory holding something that is not a cluster is never initialised over.
  const other = path.join(root, "not-a-cluster");
  mkdirSync(other);
  writeFileSync(path.join(other, "notes.txt"), "mine");
  await assert.rejects(ensureCluster(other), (error: Error) => error.message.includes(other) && /not a Postgres/.test(error.message));
  assert.equal(readFileSync(path.join(other, "notes.txt"), "utf8"), "mine");
});

test("2.2 start runs the server on the data directory, it answers SELECT 1 at the url handed back, and stop stops it", async () => {
  const dataDir = await freshCluster("start-stop");
  const server = await started({ dataDir });
  const url = new URL(server.url);
  assert.equal(url.username, "storytree");
  assert.ok(url.password.length >= 32, "the url carries the installation's password");
  assert.equal(url.host, `127.0.0.1:${server.port}`);
  assert.equal(url.pathname, "/postgres");
  assert.equal(server.dataDir, dataDir);
  assert.deepEqual(await query(server.url, "SELECT 1 AS one"), [{ one: 1 }]);
  assert.deepEqual(await query(server.url, "SHOW listen_addresses"), [{ listen_addresses: "127.0.0.1" }]);

  await stopped(server);
  assert.equal(serverRunning(dataDir), false, "the server is stopped");
  await assert.rejects(query(server.url, "SELECT 1"), { code: "ECONNREFUSED" });
  await server.stop(); // a second stop is harmless

  // A port can be asked for, and a stopped data directory started again.
  const port = await freePort();
  const again = await started({ dataDir, port });
  assert.equal(again.port, port);
  assert.deepEqual(await query(again.url, "SELECT 1 AS one"), [{ one: 1 }]);
  await stopped(again);
});

test("2.5 start can run the server with settings, as a throwaway test server runs without durability; a server started without them keeps them", async () => {
  const dataDir = await freshCluster("settings");
  const durable = await started({ dataDir });
  assert.deepEqual(await query(durable.url, "SHOW fsync"), [{ fsync: "on" }]);
  await stopped(durable);

  const throwaway = await started({ dataDir, settings: { fsync: "off", synchronous_commit: "off", full_page_writes: "off" } });
  assert.deepEqual(await query(throwaway.url, "SHOW fsync"), [{ fsync: "off" }]);
  assert.deepEqual(await query(throwaway.url, "SHOW synchronous_commit"), [{ synchronous_commit: "off" }]);
  assert.deepEqual(await query(throwaway.url, "SHOW full_page_writes"), [{ full_page_writes: "off" }]);
  await stopped(throwaway);

  // A setting the server's command line cannot carry as one word is refused before anything starts.
  await assert.rejects(start({ dataDir, settings: { fsync: "off -c port=1" } }), /fsync/);
  assert.equal(serverRunning(dataDir), false);
});

test("2.3 a second start on a data directory a live process holds is refused, naming that process, and its server is left running", async () => {
  const dataDir = await freshCluster("held");
  const holder = await hold(dataDir);

  const refusal: unknown = await start({ dataDir }).then(
    (server) => {
      servers.add(server);
      assert.fail("a second server was started on a held data directory");
    },
    (error: unknown) => error,
  );
  assert.ok(refusal instanceof DataDirInUseError, `refused with a DataDirInUseError, not ${String(refusal)}`);
  assert.equal(refusal.dataDir, dataDir);
  assert.equal(refusal.pid, holder.pid);
  assert.equal(refusal.owner, "test holder");
  assert.match(refusal.message, new RegExp(`\\b${holder.pid}\\b`), "the message names the process");
  assert.deepEqual(await query(holder.url, "SELECT 1 AS one"), [{ one: 1 }], "the holder's server is untouched");

  // Released, it can be started here; and while this process holds it, a second start here is refused too.
  await holder.release();
  const mine = await started({ dataDir });
  await assert.rejects(start({ dataDir }), (error: unknown) => error instanceof DataDirInUseError && error.pid === process.pid);
  assert.deepEqual(await query(mine.url, "SELECT 1 AS one"), [{ one: 1 }], "and the refusal leaves this process's server alone");
  await stopped(mine);
});

test("2.4 a server left running by a process that died is stopped and replaced, and a dead owner's record alone is cleared", async () => {
  const dataDir = await freshCluster("stale");
  const holder = await hold(dataDir);
  await holder.kill(); // it cannot stop its server
  assert.deepEqual(await query(holder.url, "SELECT 1 AS one"), [{ one: 1 }], "its server outlived it");

  const server = await started({ dataDir, port: await freePort() });
  assert.notEqual(server.port, holder.port);
  assert.deepEqual(await query(server.url, "SELECT 1 AS one"), [{ one: 1 }]);
  await assert.rejects(query(holder.url, "SELECT 1"), { code: "ECONNREFUSED" }, "the orphaned server was stopped");
  await stopped(server);

  // A holder that dies after its server has stopped leaves only its record behind.
  const second = await hold(dataDir);
  await second.kill();
  pgCtl(["-D", dataDir, "-m", "fast", "-w", "stop"]);
  assert.equal(serverRunning(dataDir), false);
  const recovered = await started({ dataDir });
  assert.deepEqual(await query(recovered.url, "SELECT 1 AS one"), [{ one: 1 }]);
  await stopped(recovered);
});

test("2.6 the server lets in only a client with the installation's password, which it hands over privately while it runs", async () => {
  const dataDir = path.join(root, "password");
  const server = await started({ dataDir });
  const password = decodeURIComponent(new URL(server.url).password);
  assert.ok(password.length >= 32, "a generated secret");
  assert.deepEqual(await query(server.url, "SELECT 1 AS one"), [{ one: 1 }], "the url handed back signs in");

  // Without a password nobody gets in, postgres included: the server asks for one (SASL, code 10) and never says ok (0).
  for (const user of ["postgres", "storytree", "someone_else"]) assert.equal(await firstAuthentication(server.port, user), 10, user);
  const wrong = new URL(server.url);
  wrong.password = "x".repeat(43);
  await assert.rejects(query(wrong.href, "SELECT 1"), { code: "28P01" }, "a wrong password is refused");
  assert.doesNotMatch(readFileSync(path.join(dataDir, "pg_hba.conf"), "utf8"), /trust/);

  // The owner record says a handoff is due and carries no secret; the handoff names this very launch.
  const ownerText = readFileSync(`${dataDir}.owner.json`, "utf8");
  assert.equal(ownerText.includes(password), false);
  const owner = JSON.parse(ownerText) as { token: string; port: number; auth: { version: number; method: string; installationId: string } };
  assert.equal(owner.auth.version, 1);
  assert.equal(owner.auth.method, "scram-sha-256");
  const handoff = path.join(`${dataDir}.auth`, "connection.json");
  assert.deepEqual(JSON.parse(readFileSync(handoff, "utf8")), {
    version: 1, installationId: owner.auth.installationId, ownerToken: owner.token, port: server.port, user: "storytree", password,
  });
  if (process.platform !== "win32") {
    assert.equal(lstatSync(`${dataDir}.auth`).mode & 0o777, 0o700, "only this user may enter the directory");
    assert.equal(lstatSync(handoff).mode & 0o777, 0o600, "only this user may read the handoff");
  }

  // Stopped, the handoff is withdrawn and the sign-in kept: started again, it is the same password on the new port.
  await stopped(server);
  assert.equal(existsSync(handoff), false);
  const again = await started({ dataDir, port: await freePort() });
  assert.equal(decodeURIComponent(new URL(again.url).password), password);
  assert.equal((JSON.parse(readFileSync(handoff, "utf8")) as { port: number }).port, again.port);
  await stopped(again);
});

test("2.7 a cluster made when local connections were trusted is given the password before its server starts again, keeping its data, and an interrupted start never reopens it, even for a Windows administrator", async () => {
  const dataDir = path.join(root, "legacy");
  assert.equal(tool("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8"]), 0);
  appendFileSync(path.join(dataDir, "postgresql.conf"), "\nlisten_addresses = '127.0.0.1'\n");
  const oldPort = await freePort();
  assert.equal(pgCtl(["-D", dataDir, "-o", `-p ${oldPort}`, "-l", `${dataDir}.log`, "-w", "start"]), 0);
  const passwordless = `postgres://postgres@127.0.0.1:${oldPort}/postgres`;
  await query(passwordless, "CREATE TABLE kept (note text); INSERT INTO kept VALUES ('from before passwords')");
  assert.equal(pgCtl(["-D", dataDir, "-m", "fast", "-w", "stop"]), 0);

  // A start that fails after the change (its port is taken) leaves the cluster asking for the password, and the sign-in in place.
  const taken = await occupy();
  const failed: unknown = await start({ dataDir, port: (taken.address() as { port: number }).port }).then(
    (server) => (servers.add(server), undefined),
    (error: unknown) => error,
  );
  await new Promise((resolve) => taken.close(resolve));
  assert.ok(failed instanceof Error, "the start on a taken port failed");
  assert.doesNotMatch(readFileSync(path.join(dataDir, "pg_hba.conf"), "utf8"), /trust/, "no trust survives the failed start");
  assert.equal(existsSync(`${dataDir}.owner.json`), false);
  assert.ok(existsSync(path.join(`${dataDir}.auth`, "installation.json")), "the sign-in is kept for the retry");

  // The retry starts it, the data is there, and only the password lets anyone in.
  const server = await started({ dataDir });
  assert.deepEqual(await query(server.url, "SELECT note FROM kept"), [{ note: "from before passwords" }]);
  assert.equal(await firstAuthentication(server.port, "postgres"), 10);
  const wrong = new URL(server.url);
  wrong.password = "x".repeat(43);
  await assert.rejects(query(wrong.href, "SELECT 1"), { code: "28P01" });
  await stopped(server);

  // A trust line added since is taken away again at the next start; the password stays the same.
  appendFileSync(path.join(dataDir, "pg_hba.conf"), "host all all 127.0.0.1/32 trust\n");
  const again = await started({ dataDir });
  assert.equal(again.url.replace(/:\d+\//, "/"), server.url.replace(/:\d+\//, "/"));
  assert.equal(await firstAuthentication(again.port, "postgres"), 10);
  await stopped(again);
});

test("2.8 clients sign in as an ordinary role that owns storytree's databases, never as the superuser, and a cluster's earlier databases are handed to it", async () => {
  const dataDir = await freshCluster("client-role");
  // Before: the superuser made a database with a table, a sequence of its own and a view, as a cluster from before this did.
  const before = await started({ dataDir, signIn: "superuser" });
  assert.equal(new URL(before.url).username, "postgres", "a throwaway test server may be asked for the superuser");
  assert.deepEqual(await query(before.url, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"), [{ rolsuper: true }]);
  await query(before.url, "CREATE DATABASE earlier");
  const earlier = new URL(before.url);
  earlier.pathname = "/earlier";
  await query(earlier.href, "CREATE SCHEMA notes; CREATE TABLE notes.kept (id serial PRIMARY KEY, note text); INSERT INTO notes.kept (note) VALUES ('from before'); CREATE SEQUENCE counter; CREATE VIEW notes.seen AS SELECT note FROM notes.kept");
  await stopped(before);

  const server = await started({ dataDir });
  const url = new URL(server.url);
  assert.equal(url.username, "storytree");
  const handoff = JSON.parse(readFileSync(path.join(`${dataDir}.auth`, "connection.json"), "utf8")) as { user: string; password: string };
  assert.equal(handoff.user, "storytree", "the handoff carries the ordinary role too");
  assert.deepEqual(await query(server.url, "SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user"),
    [{ rolsuper: false, rolcreaterole: false, rolcreatedb: true, rolreplication: false, rolbypassrls: false }]);
  await assert.rejects(query(server.url, "CREATE ROLE t_intruder SUPERUSER"), { code: "42501" }, "it makes no roles");
  await assert.rejects(query(server.url, "SELECT pg_read_file('postgresql.conf')"), { code: "42501" }, "it reads no server files");

  // Its password is not the superuser's, and the superuser's never reaches a client.
  const asSuperuser = new URL(server.url);
  asSuperuser.username = "postgres";
  await assert.rejects(query(asSuperuser.href, "SELECT 1"), { code: "28P01" });
  assert.equal(readFileSync(path.join(`${dataDir}.auth`, "connection.json"), "utf8").includes(decodeURIComponent(new URL(before.url).password)), false);

  // Every database is its own, with what the superuser made in it, and it carries on writing there.
  assert.deepEqual(await query(server.url, "SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE NOT datistemplate ORDER BY datname"),
    [{ datname: "earlier", owner: "storytree" }, { datname: "postgres", owner: "storytree" }]);
  const mine = new URL(server.url);
  mine.pathname = "/earlier";
  await query(mine.href, "INSERT INTO notes.kept (note) VALUES ('after'); SELECT nextval('counter'); CREATE TABLE notes.more (note text); DROP VIEW notes.seen");
  assert.deepEqual(await query(mine.href, "SELECT note FROM notes.kept ORDER BY id"), [{ note: "from before" }, { note: "after" }]);
  assert.deepEqual(await query(mine.href, "SELECT count(*)::int AS left FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'notes') AND pg_get_userbyid(c.relowner) <> 'storytree'"),
    [{ left: 0 }], "nothing there is the superuser's any more");

  // It makes databases of its own, as a new project needs.
  await query(server.url, "CREATE DATABASE t_project");
  const project = new URL(server.url);
  project.pathname = "/t_project";
  await query(project.href, "CREATE TABLE things (id int); INSERT INTO things VALUES (1)");
  assert.deepEqual(await query(project.href, "SELECT count(*)::int AS n FROM things"), [{ n: 1 }]);
  await stopped(server);
});

test("2.10 on Windows the sign-in is kept private beside a data directory whose folder lets this user change files but not take ownership, as a checkout under C:\\code does", { skip: process.platform !== "win32" && "a Windows access list" }, () => {
  // A folder granting this user Modify alone, inherited, as C:\code grants Authenticated Users: no right to change an owner.
  const parent = path.join(root, "modify-only");
  mkdirSync(parent);
  const user = `${process.env["USERDOMAIN"]}\\${process.env["USERNAME"]}`;
  const icacls = (target: string, ...args: string[]): string => {
    const ran = spawnSync("icacls", [target, ...args], { encoding: "utf8", windowsHide: true });
    assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
    return ran.stdout;
  };
  icacls(parent, "/inheritance:r", "/grant:r", `${user}:(OI)(CI)M`);

  const dataDir = path.join(parent, "data");
  assert.equal(ensureClientSignIn(dataDir).user, "storytree");
  const granted = icacls(`${dataDir}.auth`);
  assert.match(granted, /:\(OI\)\(CI\)\(F\)/, "this user holds the private directory whole");
  assert.doesNotMatch(granted, /\(I\)/, "nothing inherited from the folder");
});

test("2.9 a throwaway test server can hand back the superuser's url beside its client's, for tests' setup, while its clients and handoff stay the ordinary role", async () => {
  const dataDir = await freshCluster("superuser-beside");
  const server = await started({ dataDir, superuserUrl: true });
  assert.equal(new URL(server.url).username, "storytree", "the url clients use is the ordinary role's");
  assert.ok(server.superuserUrl, "the superuser's url is handed back when asked for");
  assert.equal(new URL(server.superuserUrl).username, "postgres");
  assert.equal(new URL(server.superuserUrl).port, String(server.port));
  assert.deepEqual(await query(server.superuserUrl, "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"), [{ rolsuper: true }]);
  await query(server.superuserUrl, "CREATE ROLE t_made_by_setup LOGIN");
  const handoff = JSON.parse(readFileSync(path.join(`${dataDir}.auth`, "connection.json"), "utf8")) as { user: string };
  assert.equal(handoff.user, "storytree", "the handoff still carries the ordinary role");
  await stopped(server);

  const plain = await started({ dataDir });
  assert.equal(plain.superuserUrl, undefined, "a server not asked for it hands back no superuser url");
  await stopped(plain);
});

// --- helpers ---------------------------------------------------------------------------------

/**
 * A cluster of its own for one test, copied from one made once by ensureCluster, with its sign-in
 * beside it (so the copy holds the password it is started with). cpSync makes the directories it
 * copies with the default mode (0755 under the usual umask), not the source's, and outside Windows
 * Postgres will not start on a data directory other users can read, so the copy is given back
 * initdb's 0700, and the sign-in its 0700 and 0600.
 */
async function freshCluster(name: string): Promise<string> {
  const template = path.join(root, "template");
  await ensureCluster(template);
  const dataDir = path.join(root, name);
  cpSync(template, dataDir, { recursive: true });
  chmodSync(dataDir, 0o700);
  cpSync(`${template}.auth`, `${dataDir}.auth`, { recursive: true });
  chmodSync(`${dataDir}.auth`, 0o700);
  chmodSync(path.join(`${dataDir}.auth`, "installation.json"), 0o600);
  return dataDir;
}

async function started(options: Parameters<typeof start>[0]): Promise<LocalPostgres> {
  const server = await start(options);
  servers.add(server);
  return server;
}

async function stopped(server: LocalPostgres): Promise<void> {
  await server.stop();
  servers.delete(server);
}

interface Holder {
  pid: number;
  url: string;
  port: number;
  /** Ask it to stop its server and exit, and wait until it has. */
  release(): Promise<void>;
  /** Kill it outright, so it cannot stop its server, and wait until it is gone. */
  kill(): Promise<void>;
}

/** A second process that starts the server on `dataDir` and holds it. */
async function hold(dataDir: string): Promise<Holder> {
  const child = spawn(process.execPath, ["--import", "tsx", holderScript, dataDir], {
    cwd: packageDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  holders.add(child);
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const match = /^ready (\S+)$/.exec(line);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
    void exited.then((code) => reject(new Error(`the holder exited (${String(code)}) before it was ready:\n${stderr}`)));
  });
  const url = await withTimeout(ready, 120_000, "the holder to start its server");
  const pid = child.pid;
  assert.ok(pid !== undefined);
  return {
    pid,
    url,
    port: Number(new URL(url).port),
    async release() {
      child.stdin.write("stop\n");
      assert.equal(await withTimeout(exited, 60_000, "the holder to stop"), 0, stderr);
      holders.delete(child);
    },
    async kill() {
      child.kill("SIGKILL");
      await withTimeout(exited, 60_000, "the holder to die");
      holders.delete(child);
    },
  };
}

async function query(url: string, sql: string): Promise<unknown[]> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

/** Run pg_ctl directly: the tests' own view of the server, independent of the code under test. */
function pgCtl(args: string[]): number {
  return tool("pg_ctl", args);
}

function tool(name: string, args: string[]): number {
  const result = spawnSync(path.join(findBinaries(), exe(name)), args, { stdio: "ignore" });
  return result.status ?? 1;
}

/**
 * The server's first answer to a client that brings no password: the authentication request code
 * of its first message (0 is "come in", 10 is "sign in with SASL"), or -1 for an error.
 */
function firstAuthentication(port: number, user: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const parameters = Buffer.from(`user\0${user}\0database\0postgres\0\0`);
    const header = Buffer.alloc(8);
    header.writeInt32BE(8 + parameters.length, 0);
    header.writeInt32BE(196608, 4); // protocol 3.0
    let received = Buffer.alloc(0);
    socket.on("connect", () => socket.write(Buffer.concat([header, parameters])));
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 9) return;
      socket.destroy();
      resolve(received[0] === 0x52 ? received.readInt32BE(5) : -1);
    });
    socket.on("error", reject);
  });
}

/** A port held by something else, so a server cannot listen there. */
function occupy(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function serverRunning(dataDir: string): boolean {
  return pgCtl(["-D", dataDir, "status"]) === 0;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000} s waiting for ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
