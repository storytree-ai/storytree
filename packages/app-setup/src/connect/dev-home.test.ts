import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { findBinaries } from "@storytree/local-postgres";
import pg from "pg";

import { makeDevHome, removeDevHome } from "./dev-home.js";

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
