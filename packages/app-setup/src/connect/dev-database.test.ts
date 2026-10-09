import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { findBinaries } from "@storytree/local-postgres";
import pg from "pg";

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`2.2 a dev home's database answers queries and releases its server on ${signal}`, { timeout: 60_000 }, async (t) => {
    const home = mkdtempSync(path.join(tmpdir(), "storytree dev database "));
    const dataDir = path.join(home, "pgdata");
    const ownerFile = `${dataDir}.owner.json`;
    const pgCtl = (...args: string[]) => spawnSync(
      path.join(findBinaries(), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl"),
      ["-D", dataDir, ...args], { encoding: "utf8", timeout: 15_000, windowsHide: true },
    );
    // Import completion means start() returned and the entry installed its handlers. The owner
    // record alone is not readiness: local-postgres writes it before it starts the server.
    const bootstrap = `
      process.argv[2] = ${JSON.stringify(home)};
      await import(${JSON.stringify(new URL("./dev-database.ts", import.meta.url).href)});
      // Windows kill() terminates unconditionally. Deliver the event to the real handler there;
      // Unix exercises native signal delivery. This does not prove Windows OS signal delivery.
      if (process.platform === "win32") process.on("message", signal => process.emit(signal));
      process.send("ready");
    `;
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", bootstrap], {
      stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
    });
    let stderr = "";
    child.stderr!.on("data", (chunk) => { stderr += chunk; });
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      if (pgCtl("status").status === 0) {
        const stopped = pgCtl("-m", "immediate", "-w", "stop");
        assert.equal(stopped.status, 0, stopped.stderr);
      }
      rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    });
    const ready = await Promise.race([
      once(child, "message", { signal: t.signal }),
      exited.then(() => { throw new Error(`database exited before readiness: ${stderr}`); }),
    ]);
    assert.deepEqual(ready, ["ready", undefined]);
    const owner = JSON.parse(readFileSync(ownerFile, "utf8")) as { pid: number; port: number };
    assert.equal(owner.pid, child.pid);
    // It asks for the home's password, which it hands over privately while it runs.
    const handoff = JSON.parse(readFileSync(path.join(`${dataDir}.auth`, "connection.json"), "utf8")) as { user: string; password: string };
    const client = new pg.Client({ host: "127.0.0.1", port: owner.port, user: handoff.user, password: handoff.password, database: "postgres", connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      assert.deepEqual((await client.query("SELECT 1 AS ready")).rows, [{ ready: 1 }]);
    } finally {
      await client.end();
    }
    if (process.platform === "win32") child.send(signal);
    else child.kill(signal);
    assert.deepEqual(await exited, [0, null], stderr);
    assert.equal(existsSync(ownerFile), false, "the entry released its database ownership");
    assert.equal(pgCtl("status").status, 3, "Postgres is stopped, not orphaned after its parent exits");
  });
}
