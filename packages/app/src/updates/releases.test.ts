import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeHttpExecutor } from "builder-util/out/nodeHttpExecutor.js";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";

import { background, type Launch } from "../lifecycle/background.js";
import { ReleaseUpdater } from "./releases.js";

test("4.4 an installed app downloads a newer release, waits for a seed, stops its database and restarts through NSIS", async (t) => {
  const feed = await fixture(t);
  let writing = true;
  let finishStop!: () => void;
  const stopped = new Promise<void>((resolve) => { finishStop = resolve; });
  const events: string[] = [];
  let target: Launch | undefined;
  const lifecycle = background({
    stopDatabase: async () => { events.push("stopping"); await stopped; events.push("stopped"); },
    relaunch: (next, inBackground) => { target = next; assert.equal(inBackground, false); events.push("installer"); },
    exit: () => { events.push("exit"); },
  });
  const updater = feed.updater(lifecycle.restart, async () => !writing);
  assert.equal(await updater.check(), "current");
  feed.version = "0.3.2";
  assert.equal(await updater.check(), "waiting");
  assert.deepEqual(events, []);
  writing = false;
  const applying = updater.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["stopping"]);
  finishStop();
  assert.equal(await applying, "restarting");
  assert.deepEqual(events, ["stopping", "stopped", "installer", "exit"]);
  assert.deepEqual(target?.args, ["--updated", "/S", "--force-run"]);
  assert.deepEqual(await readFile(target!.execPath), feed.installer);
  assert.equal(feed.downloads, 1);
});

test("4.4 a downloaded release waits for a quiet moment, says it is pending, and installs when the user asks", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.2";
  const launches: Launch[] = [];
  const updater = feed.updater(async (target) => { launches.push(target); }, async () => true, async () => false);
  assert.equal(await updater.check(), "waiting");
  assert.equal(await updater.check(), "waiting");
  assert.deepEqual(launches, []);
  assert.deepEqual(updater.request("status"), { phase: "pending", runningBuild: "0.3.1", nextBuild: "0.3.2" });
  updater.request("install");
  assert.equal(await updater.check(), "restarting");
  assert.equal(launches.length, 1);
  assert.equal(feed.downloads, 1);
});

test("4.5 a failed feed or corrupt download leaves the app running and can be retried; equal and older releases never restart it", async (t) => {
  const feed = await fixture(t);
  const launches: Launch[] = [];
  const updater = feed.updater(async (target) => { launches.push(target); }, async () => true);
  feed.offline = true;
  await assert.rejects(updater.check());
  feed.offline = false;
  feed.version = "0.3.0";
  assert.equal(await updater.check(), "current");
  feed.version = "0.3.2";
  feed.corrupt = true;
  await assert.rejects(updater.check(), /checksum/i);
  assert.deepEqual(launches, []);
  feed.corrupt = false;
  assert.equal(await updater.check(), "restarting");
  assert.equal(launches.length, 1);
});

test("4.5 repeated checks share one download and quitting prevents a pending install", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.2";
  const updater = feed.updater(async () => { assert.fail("must not restart after stopping updates"); }, async () => false);
  assert.deepEqual(await Promise.all([updater.check(), updater.check()]), ["waiting", "waiting"]);
  assert.equal(feed.downloads, 1);
  updater.stop();
  assert.equal(await updater.check(), "stopped");
});

/** A real local feed and electron-updater's real download/checksum path; no installer is executed. */
async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "storytree-release-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = Buffer.from("fixture NSIS payload — never executed");
  const state = { version: "0.3.1", offline: false, corrupt: false, downloads: 0, installer };
  const server = createServer((request, response) => {
    if (state.offline) { response.writeHead(404).end(); return; }
    if (request.url?.startsWith("/latest.yml")) {
      response.end(JSON.stringify({ version: state.version, files: [{ url: "setup.exe", size: installer.length, sha512: createHash("sha512").update(installer).digest("base64") }] }));
    } else if (request.url === "/setup.exe") {
      state.downloads++;
      response.end(state.corrupt ? Buffer.from("broken payload") : installer);
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const config = path.join(dir, "app-update.yml");
  await writeFile(config, JSON.stringify({ provider: "generic", url: `http://127.0.0.1:${address.port}`, updaterCacheDirName: "updates" }));
  return Object.assign(state, {
    updater(restart: (target: Launch, showing: boolean) => Promise<void>, canRestart: () => Promise<boolean>, quiet = async () => true) {
      const updater = new ReleaseUpdater({ restart, canRestart, quiet }, {
        version: "0.3.1", name: "storytree-test", isPackaged: true,
        appUpdateConfigPath: config, userDataPath: dir, baseCachePath: dir,
        whenReady: async () => {}, relaunch: () => assert.fail("separate relaunch"),
        quit: () => assert.fail("separate quit"), onQuit: () => assert.fail("install-on-quit bypasses lifecycle"),
      });
      // Replace only Electron's network transport, retaining its file download and digest checks.
      const transport = new NodeHttpExecutor();
      const executor = Object.assign(new ElectronHttpExecutor(), { createRequest: transport.createRequest.bind(transport) });
      Object.assign(updater, { httpExecutor: executor, _testOnlyOptions: { platform: "win32" } });
      updater.logger = null;
      updater.disableDifferentialDownload = true;
      return updater;
    },
  });
}
