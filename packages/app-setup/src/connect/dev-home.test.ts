import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { findBinaries } from "@storytree/local-postgres";
import pg from "pg";

import { makeDevHome, removeDevHome } from "./dev-home.js";

const originalSignIn = '{"refresh":"synthetic-original-sign-in"}';
const refreshedSignIn = '{"refresh":"synthetic-refreshed-sign-in"}';
const conflictingSignIn = '{"refresh":"synthetic-other-sign-in"}';

// Stop after the real credential writes, before command compilation or agent registration.
const stopBeforeBuild = async () => { throw new Error("stopped before build"); };

for (const mask of [0o022, 0o077]) {
  test(`2.8 developer-home markers contain no sign-in and sensitive paths are private under umask ${mask.toString(8)}`, async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "storytree private dev home "));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const codex = path.join(root, "source");
    mkdirSync(codex);
    writeFileSync(path.join(codex, "auth.json"), originalSignIn, { mode: 0o600 });
    const dir = path.join(root, "dev");
    const previous = process.umask(mask);
    try {
      await assert.rejects(makeDevHome({ dir, harnesses: ["codex"], signedIn: { codex }, build: stopBeforeBuild }), /stopped before build/);
    } finally { process.umask(previous); }
    const marker = path.join(dir, "storytree-dev-home.json");
    const contents = readFileSync(marker, "utf8");
    assert.equal(contents.includes("synthetic-original-sign-in"), false);
    assert.equal(JSON.parse(contents).codexSignIn.copied, undefined);
    const copy = path.join(dir, "home", ".codex", "auth.json");
    assert.equal(readFileSync(copy, "utf8"), originalSignIn);
    if (process.platform !== "win32") {
      for (const folder of [dir, path.join(dir, "home"), path.dirname(copy)]) assert.equal(statSync(folder).mode & 0o777, 0o700, folder);
      for (const file of [marker, copy]) assert.equal(statSync(file).mode & 0o777, 0o600, file);
    }
    await removeDevHome(dir);
    assert.equal(readFileSync(path.join(codex, "auth.json"), "utf8"), originalSignIn);
  });
}

for (const control of ["no Codex", "no sign-in"] as const) {
  test(`2.8 a developer home retains no sign-in when there is ${control}`, async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "storytree unsigned dev home "));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const codex = path.join(root, "source");
    mkdirSync(codex);
    if (control === "no Codex") writeFileSync(path.join(codex, "auth.json"), originalSignIn);
    const dir = path.join(root, "dev");
    await assert.rejects(makeDevHome({ dir, harnesses: control === "no Codex" ? [] : ["codex"], signedIn: { codex }, build: stopBeforeBuild }), /stopped before build/);
    assert.equal(JSON.parse(readFileSync(path.join(dir, "storytree-dev-home.json"), "utf8")).codexSignIn, undefined);
    assert.equal(existsSync(path.join(dir, "home", ".codex", "auth.json")), false);
    await removeDevHome(dir);
    assert.equal(existsSync(dir), false);
  });
}

for (const legacy of [false, true]) {
  for (const change of ["inside", "outside", "both", "source removed"] as const) {
    test(`2.8 ${legacy ? "legacy" : "digest"} markers preserve sign-ins when changed ${change}`, async (t) => {
      const root = mkdtempSync(path.join(tmpdir(), "storytree dev sign-in hand-back "));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const codex = path.join(root, "source");
      mkdirSync(codex);
      const source = path.join(codex, "auth.json");
      writeFileSync(source, originalSignIn);
      const dir = path.join(root, "dev");
      await assert.rejects(makeDevHome({ dir, harnesses: ["codex"], signedIn: { codex }, build: stopBeforeBuild }), /stopped before build/);
      const marker = path.join(dir, "storytree-dev-home.json");
      if (legacy) {
        writeFileSync(marker, JSON.stringify({ made: "2026-10-07T00:00:00.000Z", codexSignIn: { from: source, copied: originalSignIn } }));
        chmodSync(marker, 0o644);
        chmodSync(dir, 0o755);
      }
      const inside = path.join(dir, "home", ".codex", "auth.json");
      if (change !== "outside") writeFileSync(inside, refreshedSignIn);
      if (change === "outside" || change === "both") writeFileSync(source, conflictingSignIn);
      if (change === "source removed") rmSync(source);
      if (change === "both" || change === "source removed") {
        await assert.rejects(removeDevHome(dir), /changed meanwhile/);
        assert.equal(readFileSync(inside, "utf8"), refreshedSignIn);
        if (change === "both") assert.equal(readFileSync(source, "utf8"), conflictingSignIn);
        else assert.equal(existsSync(source), false, "do not resurrect a removed sign-in");
        const contents = readFileSync(marker, "utf8");
        for (const secret of ["synthetic-original-sign-in", "synthetic-refreshed-sign-in", "synthetic-other-sign-in"]) assert.equal(contents.includes(secret), false);
        assert.equal(JSON.parse(contents).codexSignIn.copied, undefined);
        if (process.platform !== "win32") {
          assert.equal(statSync(dir).mode & 0o777, 0o700);
          assert.equal(statSync(marker).mode & 0o777, 0o600);
        }
        // A refused legacy cleanup leaves a usable digest marker for the next attempt.
        writeFileSync(source, originalSignIn);
        await removeDevHome(dir);
        assert.equal(readFileSync(source, "utf8"), refreshedSignIn);
      } else {
        await removeDevHome(dir);
        assert.equal(readFileSync(source, "utf8"), change === "inside" ? refreshedSignIn : conflictingSignIn);
      }
      if (change !== "outside" && process.platform !== "win32") assert.equal(statSync(source).mode & 0o777, 0o600, "hand-back protects an existing source file");
      assert.equal(existsSync(dir), false);
    });
  }
}

for (const crashed of [false, true]) {
  test(`2.2 removing a dev home stops its real database and owner (${crashed ? "crashed" : "running"} owner)`, { timeout: 60_000 }, async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "storytree remove dev home "));
    const dir = path.join(root, "dev home");
    const made = await makeDevHome({
      dir, harnesses: [],
      // Command compilation and agent registration are covered separately. The home's actual
      // app.json and database entry are used below, with no test signal delivery or stop shim.
      build: async (tools) => {
        mkdirSync(tools, { recursive: true });
        const bins = Object.fromEntries(["storytree-mcp", "storytree-hook", "storytree-setup", "storytree"].map((name) => [name, path.join(tools, `${name}.mjs`)]));
        for (const file of Object.values(bins)) writeFileSync(file, "");
        writeFileSync(path.join(tools, "storytree-launcher.exe"), "unused launcher");
        return bins;
      },
    });
    const home = made.env.STORYTREE_HOME!;
    const dataDir = path.join(home, "pgdata");
    const ownerFile = `${dataDir}.owner.json`;
    const pgCtl = (...args: string[]) => spawnSync(
      path.join(findBinaries(), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl"),
      ["-D", dataDir, ...args], { encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    const app = JSON.parse(readFileSync(path.join(home, "app.json"), "utf8")) as { command: string; args: string[] };
    const child = spawn(app.command, app.args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = once(child, "exit");
    let postgresPid: number | undefined;
    let client: pg.Client | undefined;
    t.after(async () => {
      await client?.end();
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      if (pgCtl("status").status === 0) pgCtl("-m", "immediate", "-w", "stop");
      // The old removal can partially delete a live cluster. Cleanup must still stop that
      // test-only server even when pg_ctl has lost its postmaster.pid.
      if (postgresPid !== undefined && alive(postgresPid)) {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(postgresPid), "/T", "/F"], { stdio: "ignore" });
        else process.kill(postgresPid, "SIGQUIT");
      }
      rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    });
    for (let attempt = 0; attempt < 300; attempt++) {
      assert.equal(child.exitCode, null, stderr);
      if (existsSync(ownerFile)) {
        const owner = JSON.parse(readFileSync(ownerFile, "utf8")) as { pid: number; port: number };
        assert.equal(owner.pid, child.pid);
        const candidate = new pg.Client({ host: "127.0.0.1", port: owner.port, user: "postgres", database: "postgres", connectionTimeoutMillis: 500 });
        try {
          await candidate.connect();
          assert.deepEqual((await candidate.query("SELECT 1 AS ready")).rows, [{ ready: 1 }]);
          client = candidate;
          break;
        } catch {
          await candidate.end();
        }
      }
      await sleep(100);
    }
    assert.ok(client, `database became ready: ${stderr}`);
    postgresPid = Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]);
    assert.ok(alive(postgresPid));
    let shutdown: string | undefined;
    client.on("error", (error) => { shutdown ??= (error as pg.DatabaseError).code; });
    const disconnected = new Promise<void>((resolve) => client!.once("end", resolve));
    if (crashed) {
      child.kill("SIGKILL");
      await exited;
      assert.equal(existsSync(ownerFile), true, "crash leaves ownership for removal to clean up");
    }

    await removeDevHome(dir);

    assert.equal(alive(postgresPid), false, "the real Postgres process stopped before its home was deleted");
    await exited;
    await disconnected;
    assert.equal(shutdown, "57P01", "Postgres shut down through its native fast-stop path");
    assert.equal(existsSync(ownerFile), false, "ownership was released");
    assert.equal(existsSync(dir), false, "the developer home was removed");
  });
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
