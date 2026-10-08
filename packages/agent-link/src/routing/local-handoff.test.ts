import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { findBinaries, start } from "@storytree/local-postgres";
import pg from "pg";

import { setLibrary } from "../settings/settings.js";
import { withTempDir } from "../testing/folders.js";
import { locateApp, locateLibrary, locateStorytree, MARKER_FILE, NOT_RUNNING, route } from "./index.js";

// Synthetic credentials only. Punctuation pins URL encoding through a real SCRAM handshake.
const password = "synthetic-local-password-:@/#?% with spaces";

function powershell(script: string, file: string): void {
  execFileSync(path.join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, STORYTREE_TEST_ACL_PATH: file }, stdio: "pipe", timeout: 10_000 });
}

function privatePath(file: string, directory = false): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o700 : 0o600);
  powershell(`
    $ErrorActionPreference = 'Stop'
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = Get-Acl -LiteralPath $env:STORYTREE_TEST_ACL_PATH
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $env:STORYTREE_TEST_ACL_PATH -AclObject $acl
  `, file);
}

function expose(file: string, directory = false): void {
  if (process.platform !== "win32") return chmodSync(file, directory ? 0o755 : 0o644);
  powershell(`
    $ErrorActionPreference = 'Stop'
    $acl = Get-Acl -LiteralPath $env:STORYTREE_TEST_ACL_PATH
    $sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'ReadAndExecute', 'Allow'))
    Set-Acl -LiteralPath $env:STORYTREE_TEST_ACL_PATH -AclObject $acl
  `, file);
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

test("1.16 authenticated discovery connects to a disposable SCRAM cluster; wrong or absent passwords cannot read it", async () => {
  await withTempDir(async (home) => {
    const dataDir = path.join(home, "pgdata");
    const pwfile = path.join(home, "init-password");
    writeFileSync(pwfile, password, { mode: 0o600 });
    privatePath(pwfile);
    const initdb = path.join(findBinaries(), process.platform === "win32" ? "initdb.exe" : "initdb");
    execFileSync(initdb, ["-D", dataDir, "-U", "postgres", "-A", "scram-sha-256", "--pwfile", pwfile, "-E", "UTF8"], { stdio: "pipe", timeout: 60_000 });
    rmSync(pwfile);
    // The production lifecycle engine owns startup/shutdown; only fixture provisioning is here.
    const server = await start({ dataDir });
    const originalOwner = readFileSync(`${dataDir}.owner.json`);
    try {
      const f = fixture(home, server.port);
      const discovered = route(home, { home });
      assert.equal(discovered.status, "routed");
      if (discovered.status !== "routed") return;
      const connectionString = discovered.library.url;
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
      // start.stop() releases only its own token.
      writeFileSync(`${dataDir}.owner.json`, originalOwner);
      await server.stop();
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
    }
    if (process.platform === "win32") {
      powershell(`
        $ErrorActionPreference = 'Stop'
        $acl = Get-Acl -LiteralPath $env:STORYTREE_TEST_ACL_PATH
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'ReadData', 'Deny'))
        Set-Acl -LiteralPath $env:STORYTREE_TEST_ACL_PATH -AclObject $acl
      `, f.file);
      assert.equal(locateStorytree({ dataDir: f.dataDir }).running, false);
      privatePath(f.file);
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
