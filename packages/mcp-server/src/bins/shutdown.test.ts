/** Capability 6 · Agent tools: the tool server's shutdown, run in a child process as the server runs it. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { removeTempDir } from "@storytree/session-management/testing/folders";
import { shutdownOnce } from "./shutdown.js";

test("6.45 the tool server exits with code 0 when a delivery ran during its shutdown", async (t) => {
  // A response with many headers makes fetch's WebAssembly parser tier up in the background just
  // as the process ends; on Windows ARM, process.exit() at that moment aborts Node (0xC0000409).
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      for (let i = 0; i < 200; i++) headers[`x-pad-${i}`] = "v".repeat(40);
      response.writeHead(200, headers).end(JSON.stringify({ status: 1 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const folder = await mkdtemp(path.join(tmpdir(), "storytree-shutdown-"));
  t.after(async () => {
    server.close();
    await removeTempDir(folder);
  });
  const child = path.join(folder, "server.ts");
  const shutdown = pathToFileURL(fileURLToPath(new URL("./shutdown.ts", import.meta.url))).href;
  await writeFile(child, [
    `import { ${shutdownOnce.name} } from ${JSON.stringify(shutdown)};`,
    `const stop = ${shutdownOnce.name}({ input: process.stdin, work: () => [(async () => {`,
    `  const response = await fetch(process.argv[2], { method: "POST", body: "{}" });`,
    `  await response.text();`,
    `  process.stdout.write("delivered");`,
    `})()], graceMs: 30_000 });`,
    `process.stdin.on("close", stop);`,
    `process.stdin.resume();`,
  ].join("\n"));
  const { port } = server.address() as AddressInfo;
  const packageFolder = fileURLToPath(new URL("../../", import.meta.url));
  const runs = 3;
  for (let run = 0; run < runs; run++) {
    const proc = spawn(process.execPath, ["--import", "tsx", child, `http://127.0.0.1:${port}/batch/`], { cwd: packageFolder, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk) => { out += chunk; });
    proc.stderr.on("data", (chunk) => { err += chunk; });
    const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
    const started = Date.now();
    proc.stdin.end();
    const code = await exited;
    assert.ok(Date.now() - started < 15_000, `run ${run + 1}: the server ends on its own, before the forced exit`);
    assert.equal(out, "delivered", `run ${run + 1}: the delivery ran during the shutdown`);
    assert.equal(code, 0, `run ${run + 1}: the server exits with code 0, not ${code} (${err.trim()})`);
  }
});
