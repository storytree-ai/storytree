import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { mainUpdates, type RunningBuild } from "@storytree/app";

import { checkedUpdate, runWhenReady, startsCleanly } from "./start-check.js";

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
  const dies = script("dies.cjs", `throw new TypeError("sourceVersion: no package.json");`);
  const lingers = script("lingers.cjs", `setInterval(() => {}, 1000);`);

  process.env.ELECTRON_RUN_AS_NODE = "1";
  t.after(() => { delete process.env.ELECTRON_RUN_AS_NODE; });
  assert.equal(await startsCleanly(launch(starts)), undefined);
  assert.match(await startsCleanly(launch(dies)) ?? "", /code 1.*sourceVersion: no package\.json/s);
  assert.match(await startsCleanly(launch(lingers), 500) ?? "", /did not finish starting within 0\.5 s/);
});

test("1.13 a start that fails after the app is ready ends the app instead of lingering half-started", async () => {
  const failed: unknown[] = [];
  await runWhenReady(Promise.resolve(), async () => { throw new Error("sourceVersion"); }, (error) => failed.push(error));
  await runWhenReady(Promise.reject(new Error("not ready")), async () => {}, (error) => failed.push(error));
  assert.deepEqual(failed.map((error) => (error as Error).message), ["sourceVersion", "not ready"]);
});
