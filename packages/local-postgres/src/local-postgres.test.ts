import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, chmodSync, chownSync, cpSync, existsSync, lchownSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { after, beforeEach, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import pg from "pg";

import { ensureClientSignIn } from "./auth.js";
import { binaryPackages, DataDirInUseError, ensureCluster, findBinaries, pgCtl as pgCtlAsServer, start, type LocalPostgres } from "./index.js";
import { letThrough, serverAccount, type Account } from "./server.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const holderScript = fileURLToPath(new URL("./testing/holder.ts", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "storytree-local-postgres-"));
const exe = (tool: string): string => (process.platform === "win32" ? `${tool}.exe` : tool);
const toolAccount = serverAccount();

const servers = new Set<LocalPostgres>();
const holders = new Set<ChildProcess>();

beforeEach(() => nextTurn());

after(async () => {
  for (const holder of holders) holder.kill();
  for (const server of servers) await server.stop().catch(() => {});
  for (const entry of readdirSync(root)) {
    const dataDir = path.join(root, entry);
    if (existsSync(path.join(dataDir, "PG_VERSION")) && serverRunning(dataDir)) pgCtl(["-D", dataDir, "-m", "immediate", "-w", "stop"]);
  }
  await removeTemp(root, 2_000);
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

  assert.throws(() => findBinaries({ platform: "aix", arch: "ppc64" }), /@embedded-postgres\/aix-ppc64/);

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
  await server.stop();

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

  await holder.release();
  const mine = await started({ dataDir });
  await assert.rejects(start({ dataDir }), (error: unknown) => error instanceof DataDirInUseError && error.pid === process.pid);
  assert.deepEqual(await query(mine.url, "SELECT 1 AS one"), [{ one: 1 }], "and the refusal leaves this process's server alone");
  await stopped(mine);
});

test("2.4 a server left running by a process that died is stopped and replaced, and a dead owner's record alone is cleared", async () => {
  const dataDir = await freshCluster("stale");
  const holder = await hold(dataDir);
  await holder.kill();
  assert.deepEqual(await query(holder.url, "SELECT 1 AS one"), [{ one: 1 }], "its server outlived it");

  const server = await started({ dataDir, port: await freePort() });
  assert.notEqual(server.port, holder.port);
  assert.deepEqual(await query(server.url, "SELECT 1 AS one"), [{ one: 1 }]);
  await assert.rejects(query(holder.url, "SELECT 1"), { code: "ECONNREFUSED" }, "the orphaned server was stopped");
  await stopped(server);

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

  for (const user of ["postgres", "storytree", "someone_else"]) assert.equal(await firstAuthentication(server.port, user), 10, user);
  const wrong = new URL(server.url);
  wrong.password = "x".repeat(43);
  await assert.rejects(query(wrong.href, "SELECT 1"), { code: "28P01" }, "a wrong password is refused");
  assert.doesNotMatch(readFileSync(path.join(dataDir, "pg_hba.conf"), "utf8"), /trust/);

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

  await stopped(server);
  assert.equal(existsSync(handoff), false);
  const again = await started({ dataDir, port: await freePort() });
  assert.equal(decodeURIComponent(new URL(again.url).password), password);
  assert.equal((JSON.parse(readFileSync(handoff, "utf8")) as { port: number }).port, again.port);
  await stopped(again);
});

test("2.7 a cluster made when local connections were trusted is given the password before its server starts again, keeping its data, and an interrupted start never reopens it, even for a Windows administrator", async () => {
  const dataDir = path.join(toolsFolder("legacy-home"), "legacy");
  assert.equal(tool("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "-E", "UTF8"]), 0);
  appendFileSync(path.join(dataDir, "postgresql.conf"), "\nlisten_addresses = '127.0.0.1'\n");
  const oldPort = await freePort();
  assert.equal(pgCtl(["-D", dataDir, "-o", `-p ${oldPort}`, "-l", `${dataDir}.log`, "-w", "start"]), 0);
  const passwordless = `postgres://postgres@127.0.0.1:${oldPort}/postgres`;
  await query(passwordless, "CREATE TABLE kept (note text); INSERT INTO kept VALUES ('from before passwords')");
  assert.equal(pgCtl(["-D", dataDir, "-m", "fast", "-w", "stop"]), 0);

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

  const server = await started({ dataDir });
  assert.deepEqual(await query(server.url, "SELECT note FROM kept"), [{ note: "from before passwords" }]);
  assert.equal(await firstAuthentication(server.port, "postgres"), 10);
  const wrong = new URL(server.url);
  wrong.password = "x".repeat(43);
  await assert.rejects(query(wrong.href, "SELECT 1"), { code: "28P01" });
  await stopped(server);

  appendFileSync(path.join(dataDir, "pg_hba.conf"), "host all all 127.0.0.1/32 trust\n");
  const again = await started({ dataDir });
  assert.equal(again.url.replace(/:\d+\//, "/"), server.url.replace(/:\d+\//, "/"));
  assert.equal(await firstAuthentication(again.port, "postgres"), 10);
  await stopped(again);
});

test("2.8 clients sign in as an ordinary role that owns storytree's databases, never as the superuser, and a cluster's earlier databases are handed to it", async () => {
  const dataDir = await freshCluster("client-role");
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

  const asSuperuser = new URL(server.url);
  asSuperuser.username = "postgres";
  await assert.rejects(query(asSuperuser.href, "SELECT 1"), { code: "28P01" });
  assert.equal(readFileSync(path.join(`${dataDir}.auth`, "connection.json"), "utf8").includes(decodeURIComponent(new URL(before.url).password)), false);

  assert.deepEqual(await query(server.url, "SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE NOT datistemplate ORDER BY datname"),
    [{ datname: "earlier", owner: "storytree" }, { datname: "postgres", owner: "storytree" }]);
  const mine = new URL(server.url);
  mine.pathname = "/earlier";
  await query(mine.href, "INSERT INTO notes.kept (note) VALUES ('after'); SELECT nextval('counter'); CREATE TABLE notes.more (note text); DROP VIEW notes.seen");
  assert.deepEqual(await query(mine.href, "SELECT note FROM notes.kept ORDER BY id"), [{ note: "from before" }, { note: "after" }]);
  assert.deepEqual(await query(mine.href, "SELECT count(*)::int AS left FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public', 'notes') AND pg_get_userbyid(c.relowner) <> 'storytree'"),
    [{ left: 0 }], "nothing there is the superuser's any more");

  await query(server.url, "CREATE DATABASE t_project");
  const project = new URL(server.url);
  project.pathname = "/t_project";
  await query(project.href, "CREATE TABLE things (id int); INSERT INTO things VALUES (1)");
  assert.deepEqual(await query(project.href, "SELECT count(*)::int AS n FROM things"), [{ n: 1 }]);
  await stopped(server);
});

test("2.10 on Windows the sign-in is kept private beside a data directory whose folder lets this user change files but not take ownership, as a checkout under C:\\code does", { skip: process.platform !== "win32" && "platform:win32: a Windows access list" }, () => {
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

test("2.11 on Windows a sign-in folder a failed first run left behind is made private before any sign-in goes into it", { skip: process.platform !== "win32" && "platform:win32: a Windows access list" }, () => {
  const dataDir = path.join(root, "left-open", "data");
  mkdirSync(`${dataDir}.auth`, { recursive: true });

  assert.equal(ensureClientSignIn(dataDir).user, "storytree");
  const granted = spawnSync("icacls", [`${dataDir}.auth`], { encoding: "utf8", windowsHide: true }).stdout;
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

test("2.14 run as root (a cloud container), the Postgres tools and the server run as the unprivileged account nobody, let through the folders above what they use; run as anyone else, as that user", { skip: process.platform === "win32" && "platform:posix: user ids" }, async () => {
  const passwd = "root:x:0:0:root:/root:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n";
  assert.deepEqual(serverAccount(0, passwd), { name: "nobody", uid: 65534, gid: 65534 }, "root hands the tools to nobody");
  assert.equal(serverAccount(1000, passwd), undefined, "anyone else runs them as themselves");
  assert.throws(() => serverAccount(0, "root:x:0:0:root:/root:/bin/bash\n"), /nobody/, "root with no account to hand them to is refused, naming the one it looked for");

  const nobody: Account = { name: "nobody", uid: 65534, gid: 65534 };
  const outer = path.join(root, "shut");
  const inner = path.join(outer, "inner");
  const open = path.join(inner, "open");
  mkdirSync(open, { recursive: true });
  chmodSync(outer, 0o700);
  chmodSync(inner, 0o750);
  chmodSync(open, 0o755);
  letThrough(path.join(open, "data"), nobody);
  assert.equal(lstatSync(outer).mode & 0o777, 0o701);
  assert.equal(lstatSync(inner).mode & 0o777, 0o751);
  assert.equal(lstatSync(open).mode & 0o777, 0o755, "a folder that already lets it through is left as it was");

  const account = serverAccount() ?? { name: "self", uid: process.getuid!(), gid: process.getgid!() };
  const dataDir = path.join(root, "through-account");
  const server = await started({ dataDir, account });
  assert.deepEqual(await query(server.url, "SELECT 1 AS one"), [{ one: 1 }]);
  assert.equal(lstatSync(dataDir).uid, account.uid, "the cluster is the account's");
  assert.equal(lstatSync(`${dataDir}.log`).uid, account.uid, "and so is the server's log");
  await stopped(server);
});

test("2.14 a caller's pg_ctl on a data directory runs as the server does, let through the folders above it, so run as root it reads whether the server runs and stops it", { skip: process.platform === "win32" && "platform:posix: user ids" }, async () => {
  const above = path.join(root, "caller-pg-ctl");
  mkdirSync(above);
  const dataDir = path.join(above, "data");
  const server = await started({ dataDir });
  chmodSync(above, 0o700);
  assert.equal(await pgCtlAsServer(dataDir, ["status"]), 0, "it reads the server running");
  assert.equal(await pgCtlAsServer(dataDir, ["-m", "fast", "-w", "stop"], { timeoutMs: 60_000 }), 0, "and stops it");
  assert.equal(await pgCtlAsServer(dataDir, ["status"]), 3, "then reads it stopped");
  await assert.rejects(query(server.url, "SELECT 1"), { code: "ECONNREFUSED" });
  await stopped(server);
});

test("2.15 a database an interrupted run left invalid is dropped when the server next starts, saying so once, so it can be made again and connected to", async () => {
  const dataDir = await freshCluster("invalid-database");
  const before = await started({ dataDir, superuserUrl: true });
  await query(before.url, "CREATE DATABASE \"storytree_t-broken\"");
  await query(before.url, "CREATE DATABASE t_kept");
  assert.ok(before.superuserUrl);
  await query(before.superuserUrl, "UPDATE pg_database SET datconnlimit = -2 WHERE datname = 'storytree_t-broken'");
  const broken = new URL(before.url);
  broken.pathname = "/storytree_t-broken";
  await assert.rejects(query(broken.href, "SELECT 1"), /invalid database/);
  await stopped(before);

  const said: string[] = [];
  const server = await started({ dataDir, log: (message) => said.push(message) });
  assert.deepEqual(await query(server.url, "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname"),
    [{ datname: "postgres" }, { datname: "t_kept" }], "the invalid database is gone and the valid one kept");
  assert.equal(said.filter((message) => message.includes("storytree_t-broken")).length, 1, said.join("\n"));
  await query(server.url, "CREATE DATABASE \"storytree_t-broken\"");
  const remade = new URL(server.url);
  remade.pathname = "/storytree_t-broken";
  assert.deepEqual(await query(remade.href, "SELECT 1 AS one"), [{ one: 1 }]);
  await stopped(server);
});

async function freshCluster(name: string): Promise<string> {
  const template = path.join(root, "template");
  await ensureCluster(template);
  const dataDir = path.join(root, name);
  cpSync(template, dataDir, { recursive: true });
  keepOwner(template, dataDir);
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
  release(): Promise<void>;
  kill(): Promise<void>;
}

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

function pgCtl(args: string[]): number {
  return tool("pg_ctl", args);
}

function tool(name: string, args: string[]): number {
  const result = spawnSync(path.join(findBinaries(), exe(name)), args, {
    stdio: "ignore",
    ...(toolAccount === undefined ? {} : { uid: toolAccount.uid, gid: toolAccount.gid }),
  });
  return result.status ?? 1;
}

function toolsFolder(name: string): string {
  const dir = path.join(root, name);
  mkdirSync(dir);
  if (toolAccount !== undefined) {
    chownSync(dir, toolAccount.uid, toolAccount.gid);
    letThrough(path.join(dir, "inside"), toolAccount);
  }
  return dir;
}

function keepOwner(from: string, to: string): void {
  if (process.platform === "win32") return;
  const source = lstatSync(from);
  const copy = lstatSync(to);
  if (copy.uid !== source.uid || copy.gid !== source.gid) lchownSync(to, source.uid, source.gid);
  if (source.isDirectory()) for (const entry of readdirSync(from)) keepOwner(path.join(from, entry), path.join(to, entry));
}

function firstAuthentication(port: number, user: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const parameters = Buffer.from(`user\0${user}\0database\0postgres\0\0`);
    const header = Buffer.alloc(8);
    header.writeInt32BE(8 + parameters.length, 0);
    header.writeInt32BE(196608, 4);
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

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let settled = false;
  const outcome = promise.finally(() => (settled = true));
  outcome.catch(() => {});
  await waitUntil(() => settled, ms, what);
  return outcome;
}
