import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

import { mainUpdates, type RunningBuild } from "@storytree/app";

import { checkedUpdate, finishStartCheck, runWhenReady, startsCleanly } from "./start-check.js";

test("4.17 a built main that cannot start is never restarted into: the running app stays, the same commit is not built again, and the next good main is", async () => {
  let main = "bad1234567";
  const built: string[] = [];
  const restarted: string[] = [];
  // Stands in for follow-main's updateToMain: build main's commit in the other slot.
  const update = async ({ running, build }: { running: RunningBuild; build: (dir: string) => Promise<void> }) => {
    if (main === running.sha) return undefined;
    const dir = path.join("runtime", "b", main);
    await build(dir);
    return { slot: "b" as const, dir, sha: main };
  };
  const updates = mainUpdates({
    runtimeDir: "runtime",
    running: { slot: "a", dir: path.join("runtime", "a"), sha: "good000000" },
    runningBuild: "main good000",
    canRestart: async () => true,
    restart: async (next) => { restarted.push(next.sha); },
    update: checkedUpdate(update as never, {
      build: async (dir) => { built.push(path.basename(dir)); },
      shaOf: async (dir) => path.basename(dir),
      startCheck: async (dir) => path.basename(dir).startsWith("bad") ? "exited with code 1: TypeError: sourceVersion" : undefined,
    }),
  });

  const refused = await updates.check();
  assert.equal(refused.phase, "failed");
  assert.match(refused.reason ?? "", /main bad1234 .*cannot start.*sourceVersion/);
  assert.deepEqual(restarted, [], "the running app is never restarted into a build that cannot start");

  assert.equal((await updates.check()).phase, "failed");
  assert.deepEqual(built, ["bad1234567"], "a commit that could not start is not built again");

  main = "fixed00000";
  await updates.check();
  assert.deepEqual(restarted, ["fixed00000"], "the next main that starts is restarted into");
});

test("4.17 the start check passes a build only when its main process exits 0 when asked to check, and gives up on one that lingers", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "start-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = (name: string, body: string): string => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return file;
  };
  const launch = (file: string) => ({ execPath: process.execPath, args: [file] });
  const starts = script("starts.cjs", `
    if (!process.argv.includes("--start-check")) process.exit(2);
    if (process.env.ELECTRON_RUN_AS_NODE !== undefined) process.exit(3);
    process.exit(0);`);
  // A long stack after the message must not push the message out of the refusal.
  const dies = script("dies.cjs", `console.error("x".repeat(20)); throw new TypeError("sourceVersion: no package.json" + "\\n    at frame".repeat(200));`);
  const lingers = script("lingers.cjs", `setInterval(() => {}, 1000);`);
  const ownHome = script("own-home.cjs", `process.exit(process.env.STORYTREE_HOME === "throwaway" ? 0 : 4);`);

  process.env.ELECTRON_RUN_AS_NODE = "1";
  t.after(() => { delete process.env.ELECTRON_RUN_AS_NODE; });
  assert.equal(await startsCleanly(launch(starts)), undefined);
  assert.match(await startsCleanly(launch(dies)) ?? "", /code 1.*sourceVersion: no package\.json/s);
  assert.match(await startsCleanly(launch(lingers), 500) ?? "", /did not finish starting within 0\.5 s/);
  assert.equal(await startsCleanly({ ...launch(ownHome), env: { ...process.env, STORYTREE_HOME: "throwaway" } }), undefined, "the install check starts the app with a throwaway home");
});

test("1.13 a start that fails after the app is ready ends the app instead of lingering half-started", async () => {
  const failed: unknown[] = [];
  await runWhenReady(Promise.resolve(), async () => { throw new Error("sourceVersion"); }, (error) => failed.push(error));
  await runWhenReady(Promise.reject(new Error("not ready")), async () => {}, (error) => failed.push(error));
  assert.deepEqual(failed.map((error) => (error as Error).message), ["sourceVersion", "not ready"]);
});

test("4.17 a startup timeout names the running child and keeps bounded output from both ends", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "start-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "stalled.cjs");
  writeFileSync(file, `console.log("startup entered"); console.log("x".repeat(5000)); console.error("waiting for handlers"); setInterval(() => {}, 1000);`);
  const problem = await startsCleanly({ execPath: process.execPath, args: [file] }, 1000);
  assert.match(problem ?? "", /did not finish starting within 1 s.*process \d+.*still running/s);
  assert.match(problem ?? "", /stdout open.*stderr open/);
  assert.match(problem ?? "", /startup entered/);
  assert.match(problem ?? "", /waiting for handlers/);
  assert.ok(problem!.length < 1800, "a noisy child cannot flood the refusal");
});

test("4.17 an exited child with inherited output pipes is diagnosed and cannot keep the checker alive", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "start-check-"));
  const pidFile = path.join(dir, "holder.pid");
  t.after(() => {
    if (existsSync(pidFile)) {
      try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* Already ended. */ }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const child = path.join(dir, "exits.cjs");
  writeFileSync(child, `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 15000)"], { stdio: ["ignore", "inherit", "inherit"] });
    writeFileSync(${JSON.stringify(pidFile)}, String(holder.pid));
    process.stdout.write("start check: the main process reached its handlers\\n", () => process.exit(0));
  `);
  const checker = path.join(dir, "checker.mjs");
  const checkModule = pathToFileURL(path.join(import.meta.dirname, "start-check.ts")).href;
  writeFileSync(checker, `
    import { startsCleanly } from ${JSON.stringify(checkModule)};
    console.log(await startsCleanly({ execPath: process.execPath, args: [${JSON.stringify(child)}] }, 2000));
  `);
  // The checker must exit naturally after refusing, although a descendant still holds its pipes.
  const { stdout } = await promisify(execFile)(process.execPath, [checker], { timeout: 6000 });
  assert.match(stdout, /exited with code 0.*stdout open.*stderr open/s);
  assert.match(stdout, /main process reached its handlers/);
});

test("4.17 a start that leaves a promise rejection unhandled fails its check, though the process still exits 0", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "start-check-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const finish = pathToFileURL(path.join(import.meta.dirname, "start-check.ts")).href;
  const start = (name: string, plant: string): { execPath: string; args: string[] } => {
    const file = path.join(dir, name);
    writeFileSync(file, `import { finishStartCheck } from ${JSON.stringify(finish)};\n${plant}\nawait finishStartCheck((code) => process.exit(code));\n`);
    // Electron's main process only warns of an unhandled rejection, as Node does in this mode.
    return { execPath: process.execPath, args: ["--unhandled-rejections=warn", file] };
  };
  assert.equal(await startsCleanly(start("starts.mjs", "")), undefined);
  assert.match(await startsCleanly(start("rejects.mjs", `void Promise.resolve().then(() => { throw new Error("planted"); });`)) ?? "", /unhandled promise rejection: Error: planted/);
});
