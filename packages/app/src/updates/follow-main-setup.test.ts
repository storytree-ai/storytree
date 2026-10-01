/**
 * Capability 4 · Updates: `pnpm app:follow-main`, the one-off setup of the app that follows merged
 * main, contract 4.11 in the app story (ADR-0637 D2). A throwaway home; the build and the start are
 * stand-ins, since a real one clones, installs and bundles the whole app.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { followMain } from "./follow-main-setup.js";
import type { RunningBuild } from "./follow-main.js";

const BUILT: RunningBuild = { slot: "a", dir: "/runtime/a", sha: "0123456789abcdef" };

function home(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-follow-main-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("4.11 setting up the app that follows main refuses while the app is running, naming its process, and builds nothing", async (t) => {
  const dir = home(t);
  mkdirSync(path.join(dir, "pgdata"));
  writeFileSync(path.join(dir, "pgdata.owner.json"), JSON.stringify({ pid: process.pid }));
  const done: string[] = [];
  const said: string[] = [];

  const result = await followMain({ home: dir, setUp: async () => (done.push("set up"), BUILT), start: () => (done.push("start"), 1), say: (line) => said.push(line) });

  assert.deepEqual(result, { refused: process.pid });
  assert.deepEqual(done, [], "nothing is built or started");
  assert.match(said.join("\n"), new RegExp(`running \\(process ${process.pid}\\)`));
});

test("4.11 with the app not running, it builds merged main in the runtime folder and starts the app from that build, in the background unless asked to show its window", async (t) => {
  const dir = home(t);
  // An owner record whose process has gone is no running app.
  writeFileSync(path.join(dir, "pgdata.owner.json"), JSON.stringify({ pid: 2 ** 31 - 2 }));
  const setUps: { runtimeDir: string; origin: string }[] = [];
  const starts: { build: RunningBuild; show: boolean }[] = [];
  const options = {
    home: dir,
    origin: "/the/origin",
    setUp: async ({ runtimeDir, origin }: { runtimeDir: string; origin: string }) => (setUps.push({ runtimeDir, origin }), BUILT),
    start: (build: RunningBuild, show: boolean) => (starts.push({ build, show }), 4242),
    say: () => {},
  };

  assert.deepEqual(await followMain(options), { started: 4242, build: BUILT });
  assert.deepEqual(await followMain({ ...options, show: true }), { started: 4242, build: BUILT });
  assert.deepEqual(setUps, [1, 2].map(() => ({ runtimeDir: path.join(dir, "runtime"), origin: "/the/origin" })));
  assert.deepEqual(starts.map(({ show }) => show), [false, true]);
});
