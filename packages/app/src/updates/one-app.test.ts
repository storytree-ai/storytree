/**
 * Capability 4 · Updates, contract 4.18 in the app story (ADR-0940 D1): one storytree desktop app per
 * machine. A throwaway home holding an installed payload and a follow-main setup; the build and the
 * start are stand-ins.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { followMain } from "./follow-main-setup.js";
import { appDirIn, type RunningBuild } from "./follow-main.js";
import { otherApp } from "./one-app.js";

function machine(t: TestContext): { home: string; localAppData: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-one-app-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { home: path.join(dir, ".storytree", "0.3"), localAppData: path.join(dir, "AppData", "Local") };
}

function install({ localAppData }: { localAppData: string }): string {
  const dir = path.join(localAppData, "Programs", "storytree-0.3");
  mkdirSync(path.join(dir, "resources"), { recursive: true });
  writeFileSync(path.join(dir, "resources", "storytree-installed"), "nsis");
  return dir;
}

function setUpFollowMain({ home }: { home: string }): string {
  const electron = path.join(appDirIn(path.join(home, "runtime", "b")), "node_modules", "electron");
  mkdirSync(electron, { recursive: true });
  writeFileSync(path.join(electron, "path.txt"), "electron");
  return path.join(home, "runtime");
}

test("4.18 setting up the app that follows main refuses where an installed app is present, naming its folder and how to remove it, and builds nothing", async (t) => {
  const box = machine(t);
  const installed = install(box);
  const done: string[] = [];
  const said: string[] = [];

  const result = await followMain({ home: box.home, localAppData: box.localAppData, setUp: async () => (done.push("set up"), {} as RunningBuild), start: () => (done.push("start"), 1), say: (line) => said.push(line) });

  assert.deepEqual(result, { refused: installed });
  assert.deepEqual(done, [], "nothing is built or started");
  assert.ok(said.join("\n").includes(installed), "it names the installed app's folder");
  assert.match(said.join("\n"), /uninstall/i, "it says how to remove it");
});

test("4.18 each app's start refuses where the other copy is, naming it; alone, neither refuses", (t) => {
  const box = machine(t);
  assert.equal(otherApp({ starting: "follow-main", ...box }), undefined);
  assert.equal(otherApp({ starting: "installed", ...box }), undefined);

  const runtime = setUpFollowMain(box);
  assert.equal(otherApp({ starting: "follow-main", ...box }), undefined, "the follow-main app alone starts");
  const refusedInstalled = otherApp({ starting: "installed", ...box });
  assert.ok(refusedInstalled?.includes(runtime), "the installed app names the follow-main app's folder");

  const installed = install(box);
  const refusedFollowMain = otherApp({ starting: "follow-main", ...box });
  assert.ok(refusedFollowMain?.includes(installed), "the follow-main app names the installed app's folder");
  assert.match(refusedFollowMain ?? "", /uninstall/i);
});
