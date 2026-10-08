import assert from "node:assert/strict";
import childProcess, { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";

import { findBinaries } from "@storytree/local-postgres";
import pg from "pg";

import { setLibrary } from "../settings/settings.js";
import { withTempDir } from "../testing/folders.js";
import { locateApp, locateLibrary, locateStorytree, MARKER_FILE, NOT_RUNNING, route } from "./index.js";

// Synthetic credentials only. Punctuation pins URL encoding through a real SCRAM handshake.
const password = "synthetic-local-password-:@/#?% with spaces";

function windowsAcl(file: string, action: "private" | "expose" | "deny-read"): void {
  // Fixture setup needs no PowerShell/.NET startup. Keep the previous ten-second bound
  // across ALL native children in this operation, with no retry or timeout extension.
  const started = performance.now();
  const run = (stage: string, command: string, args: string[]) => {
    const timeout = Math.floor(10_000 - (performance.now() - started));
    const label = `discovery fixture ACL ${action}/${stage} ${path.basename(file)}`;
    assert.ok(timeout > 0, `${label}: exhausted ten-second operation bound`);
    console.info(`${label}: START (${Math.round(performance.now() - started)} ms)`);
    const result = spawnSync(path.join(process.env.SystemRoot!, "System32", command), args, {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true,
    });
    const evidence = `${label}: pid=${result.pid} status=${result.status} signal=${result.signal} error=${result.error?.message ?? "none"} (${Math.round(performance.now() - started)} ms)`;
    console.info(evidence);
    assert.ok(!result.error && result.status === 0,
      `${evidence}\n${result.stdout?.slice(-2000) ?? ""}\n${result.stderr?.slice(-2000) ?? ""}`);
    return result.stdout;
  };
  if (action === "expose") {
    run("grant-everyone", "icacls.exe", [file, "/grant", "*S-1-1-0:RX"]);
    return;
  }
  // Parse only the numeric SID, never localized headings or account names.
  const identity = run("current-user", "whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = identity.match(/,"(S-1-\d+(?:-\d+)+)"\s*$/)?.[1];
  assert.ok(sid, "whoami did not return a current-user SID");
  if (action === "deny-read") {
    run("deny-current-user", "icacls.exe", [file, "/deny", `*${sid}:(RD)`]);
    return;
  }
  run("owner", "icacls.exe", [file, "/setowner", `*${sid}`]);
  // Reset removes explicit grants AND denies left by the adversarial cases; then remove
  // inherited entries and grant only the current user. All files contain synthetic data.
  run("reset", "icacls.exe", [file, "/reset"]);
  run("private", "icacls.exe", [file, "/inheritance:r", "/grant:r", `*${sid}:F`]);
}

function privatePath(file: string, directory = false): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o700 : 0o600);
  windowsAcl(file, "private");
}

function expose(file: string, directory = false): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o755 : 0o644);
  windowsAcl(file, "expose");
}

function fixture(home: string, port = 54321) {
  const dataDir = path.join(home, "pgdata");
  const directory = `${dataDir}.auth`;
  const file = path.join(directory, "connection.json");
  const owner = { pid: process.pid, port, token: randomUUID(), auth: { version: 1, method: "scram-sha-256", installationId: randomUUID() } };
  const credentials = { version: 1, installationId: owner.auth.installationId, ownerToken: owner.token, port, user: "postgres", password };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  privatePath(directory, true);
  const save = () => {
    writeFileSync(`${dataDir}.owner.json`, JSON.stringify(owner));
    writeFileSync(file, JSON.stringify(credentials), { mode: 0o600 });
    privatePath(file);
  };
  save();
  writeFileSync(path.join(home, MARKER_FILE), JSON.stringify({ project: "synthetic" }));
  return { dataDir, directory, file, owner, credentials, save };
}

test("1.16 authenticated discovery connects to an independently provisioned SCRAM cluster; wrong or absent passwords cannot read it", async () => {
  await withTempDir(async (home) => {
    const dataDir = path.join(home, "pgdata");
    const pwfile = path.join(home, "init-password");
    writeFileSync(pwfile, password, { mode: 0o600 });
    privatePath(pwfile);
    const initdb = path.join(findBinaries(), process.platform === "win32" ? "initdb.exe" : "initdb");
    execFileSync(initdb, ["-D", dataDir, "-U", "postgres", "-A", "scram-sha-256", "--pwfile", pwfile, "-E", "UTF8"], { stdio: "pipe", timeout: 60_000 });
    rmSync(pwfile);
    // This consumer fixture owns its server and credentials. The production launcher's
    // untouched handoff is exercised by project-routing 1.4, including after it adopts auth.
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const { port } = listener.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    const pgctl = path.join(findBinaries(), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
    try {
      // No inherited pipes: Windows pg_ctl can leave their handles in the server's shell.
      execFileSync(pgctl, ["-D", dataDir, "-o", `-p ${port} -c listen_addresses=127.0.0.1`,
        "-l", path.join(home, "server.log"), "-w", "start"], { stdio: "ignore", timeout: 60_000 });
      const f = fixture(home, port);
      const discovered = route(home, { home });
      assert.equal(discovered.status, "routed", discovered.status === "not-running" ? discovered.message : "project routing failed");
      if (discovered.status !== "routed") return;
      const connectionString = discovered.library.url;
      assert.equal(connectionString, `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`);
      const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
      try {
        await client.connect();
        assert.deepEqual((await client.query("SELECT 42 AS synthetic")).rows, [{ synthetic: 42 }]);
      } finally { await client.end(); }
      for (const bad of ["", "incorrect-synthetic-password"]) {
        const url = new URL(connectionString!);
        url.password = bad;
        const rejected = new pg.Client({ connectionString: url.href, password: () => bad, connectionTimeoutMillis: 3000 });
        try { await assert.rejects(rejected.connect()); } finally { await rejected.end(); }
      }
      assert.equal(readFileSync(`${dataDir}.owner.json`, "utf8").includes(password), false);
      assert.equal(locateLibrary({ home }).found, true);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, true);
    } finally {
      // Also stop a server whose startup timed out after creating its PID file.
      if (existsSync(path.join(dataDir, "postmaster.pid"))) {
        execFileSync(pgctl, ["-D", dataDir, "-m", "immediate", "-w", "stop"], { stdio: "ignore", timeout: 60_000 });
      }
    }
  });
});

test("1.16 Windows privacy refusals explain the failed check without subprocess output or credentials", async (t) => {
  await withTempDir((home) => {
    fixture(home);
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    let failure: unknown;
    const child = t.mock.method(childProcess, "execFileSync", () => {
      if (failure) throw failure;
      return "unexpected private output";
    });
    syncBuiltinESMExports();
    try {
      for (const [details, reason] of [
        [{ code: "ETIMEDOUT" }, "windows-acl-timeout"],
        [{ code: "ENOENT" }, "windows-acl-process"],
        [{ status: 11 }, "windows-acl-owner"],
        [{ status: 12 }, "windows-acl-inheritance"],
        [{ status: 13 }, "windows-acl-exposed"],
        [{ status: 14 }, "windows-acl-no-owner-grant"],
        [{ status: 1 }, "windows-acl-process"],
        [undefined, "windows-acl-output"],
      ] as const) {
        failure = details && Object.assign(new Error(password), details, { stdout: password, stderr: password });
        const result = route(home, { home });
        assert.equal(result.status, "not-running");
        if (result.status !== "not-running") continue;
        assert.match(result.message, new RegExp(`\\(${reason}\\)$`));
        assert.equal(JSON.stringify(result).includes(password), false);
        assert.equal(JSON.stringify(result).includes(encodeURIComponent(password)), false);
        assert.equal(JSON.stringify(result).includes(home), false);
      }
    } finally {
      child.mock.restore();
      syncBuiltinESMExports();
      Object.defineProperty(process, "platform", platform);
    }
  });
});

test("1.16 authenticated metadata errors refuse without secrets or a passwordless fallback", async () => {
  await withTempDir((home) => {
    const f = fixture(home);
    const refused = () => {
      const result = route(home, { home });
      assert.equal(result.status, "not-running");
      assert.equal(locateLibrary({ home }).found, false);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
      assert.equal(JSON.stringify(result).includes(password), false);
      assert.equal(JSON.stringify(result).includes(encodeURIComponent(password)), false);
    };
    for (const content of ["{", "null", "[]", "x".repeat(16_385), JSON.stringify({ password }),
      ...["version", "installationId", "ownerToken", "port", "user", "password"].map((key) => JSON.stringify({ ...f.credentials, [key]: null })),
      JSON.stringify({ ...f.credentials, installationId: randomUUID() }),
      JSON.stringify({ ...f.credentials, ownerToken: randomUUID() }),
      JSON.stringify({ ...f.credentials, port: 54322 }),
    ]) {
      writeFileSync(f.file, content);
      refused();
    }
    f.save();
    rmSync(f.file);
    refused();
    mkdirSync(f.file); // An unreadable-as-file handoff must not become legacy discovery.
    refused();
    rmSync(f.file, { recursive: true });
    f.save();
    for (const auth of [null, {}, "legacy", { ...f.owner.auth, version: 2 }, { ...f.owner.auth, method: "trust" }]) {
      writeFileSync(`${f.dataDir}.owner.json`, JSON.stringify({ ...f.owner, auth }));
      refused();
    }
    // A private handoff beside a downgraded owner record is not an old installation.
    const { auth: _auth, ...legacy } = f.owner;
    writeFileSync(`${f.dataDir}.owner.json`, JSON.stringify(legacy));
    refused();
    f.save();
    rmSync(f.directory, { recursive: true });
    refused();
  });
});

test("1.16 exposed credentials, linked files and insecure directories refuse on the host platform", async () => {
  await withTempDir((home) => {
    const f = fixture(home);
    assert.equal(locateStorytree({ dataDir: f.dataDir }).running, true);
    for (const [file, directory] of [[f.file, false], [f.directory, true]] as const) {
      expose(file, directory);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
      privatePath(file, directory);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, true);
    }
    if (process.platform === "win32") {
      windowsAcl(f.file, "deny-read");
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
      privatePath(f.file);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, true);
    }
    if (process.platform === "darwin") {
      execFileSync("/bin/chmod", ["+a", "everyone allow read", f.file]);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
      execFileSync("/bin/chmod", ["-N", f.file]);
    }
    const moved = `${f.directory}-moved`;
    renameSync(f.directory, moved);
    symlinkSync(moved, f.directory, process.platform === "win32" ? "junction" : "dir");
    assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
    rmSync(f.directory);
    renameSync(moved, f.directory);
    const alias = path.join(home, "copied-link");
    linkSync(f.file, alias);
    assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
    rmSync(alias);
    if (process.platform !== "win32") {
      chmodSync(f.file, 0);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
      privatePath(f.file);
      writeFileSync(alias, JSON.stringify(f.credentials), { mode: 0o600 });
      rmSync(f.file);
      symlinkSync(alias, f.file);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
    }
  });
});

test("1.16 damaged credentials preserve app liveness, quick stale-owner refusal and explicit remote routing", async () => {
  await withTempDir((home) => {
    const f = fixture(home);
    rmSync(f.file);
    assert.deepEqual(locateApp(home), { running: true });
    const cloudSql = { instance: "synthetic:region:database", user: "test@example.invalid" };
    setLibrary(["cloudsql", cloudSql.instance, cloudSql.user], home);
    assert.deepEqual(locateLibrary({ home }), { found: true, connect: { cloudSql } });
    const address = "postgres://synthetic@db.example.invalid/postgres";
    setLibrary(["postgres", address], home);
    assert.deepEqual(locateLibrary({ home }), { found: true, connect: { address } });
    const gone = spawnSync(process.execPath, ["-e", "0"]).pid;
    writeFileSync(`${f.dataDir}.owner.json`, JSON.stringify({ ...f.owner, pid: gone }));
    const before = performance.now();
    assert.deepEqual(locateStorytree({ dataDir: f.dataDir }), { running: false, message: NOT_RUNNING });
    assert.ok(performance.now() - before < 500);
    assert.deepEqual(locateApp(home), { running: false });
  });
});
