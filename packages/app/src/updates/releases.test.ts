import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { NodeHttpExecutor } from "builder-util/out/nodeHttpExecutor.js";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";

import { background, type Launch } from "../lifecycle/background.js";
import { keepBackups } from "../lifecycle/backups.js";
import { ReleaseUpdater } from "./releases.js";

test("4.15 stable downloads only the pinned artifact while development continues to advance; no stable feed never falls back", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.9";
  feed.stable = "0.3.2";
  const stable = feed.updater(async () => {}, async () => false, async () => false, "stable");
  const development = feed.updater(async () => {}, async () => false, async () => false, "development");
  assert.equal(await stable.check(), "waiting");
  assert.equal(stable.request("status").nextBuild, "0.3.2");
  assert.equal(await development.check(), "waiting");
  assert.equal(development.request("status").nextBuild, "0.3.9");
  feed.stable = undefined;
  let installed = 0;
  const unpinned = feed.updater(async () => { installed++; }, async () => true, async () => true, "stable");
  await assert.rejects(unpinned.check(), /404|channel/i);
  assert.equal(installed, 0);
  assert.equal(unpinned.request("status").phase, "failed");
  feed.stable = "0.3.3";
  assert.equal(await unpinned.check(), "restarting");
  assert.equal(unpinned.request("status").nextBuild, "0.3.3");
});

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

for (const entry of ["automatic", "menu"] as const) {
  test(`4.4 the ${entry} release restart keeps its window open while a snapshot is being written`, async (t) => {
    const feed = await fixture(t);
    feed.version = "0.3.2";
    let finishSnapshot!: () => void;
    const writing = new Promise<void>(resolve => { finishSnapshot = resolve; });
    let backups: ReturnType<typeof keepBackups> | undefined;
    t.after(() => backups?.stop());
    const startBackup = () => backups ??= keepBackups({ dir: path.join(feed.holds, "backups"), log: () => {}, storytree: {
      listProjects: async () => ["project"],
      snapshot: async () => {
        await writing;
        return { format: "storytree-project-snapshot", version: 1, project: "project", takenAt: new Date().toISOString(), records: [], history: [] };
      },
    } });
    let windowOpen = true, restarts = 0;
    const lifecycle = background({
      stopPages: () => { windowOpen = false; }, stopDatabase: async () => { backups?.stop(); },
      relaunch: () => { restarts++; }, exit: () => {},
    });
    const updater = feed.updater(lifecycle.restart, async () => backups?.canRestart() ?? true, async () => {
      startBackup(); // A daily snapshot can start during the asynchronous quiet-moment read.
      await new Promise(resolve => setImmediate(resolve));
      return true;
    });
    t.after(() => updater.stop());
    if (entry === "menu") { startBackup(); updater.request("install"); }
    const result = await updater.check();
    assert.equal(windowOpen, true, "a snapshot never strands the user in shutdown");
    assert.equal(result, "waiting");
    assert.equal(updater.request("status").phase, "pending");
    assert.match(updater.request("status").reason ?? "", /library.*writing/i);
    finishSnapshot();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await updater.check(), "restarting");
    await updater.check();
    assert.equal(windowOpen, false);
    assert.equal(restarts, 1);
    assert.equal(feed.downloads, 1);
  });
}

test("4.12 a named run holds an automatic release install until released, without holding the download", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.2";
  const launches: Launch[] = [];
  const updater = feed.updater(async target => { launches.push(target); }, async () => true);
  await mkdir(feed.holds);
  const hold = path.join(feed.holds, "trial.json");
  await writeFile(hold, JSON.stringify({ run: "Codex trial", startedAt: Date.now(), expiresAt: Date.now() + 60_000 }));
  assert.equal(await updater.check(), "waiting");
  assert.deepEqual(launches, []);
  assert.equal(feed.downloads, 1);
  assert.match(updater.request("status").reason!, /Codex trial/);
  await rm(hold);
  assert.equal(await updater.check(), "restarting");
  assert.equal(launches.length, 1);
  assert.equal(feed.downloads, 1);
});

test("4.12 each overlapping run keeps its hold; expired or malformed holds cannot disable updates indefinitely", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.2";
  const updater = feed.updater(async () => {}, async () => true);
  await mkdir(feed.holds);
  const now = Date.now();
  for (const run of ["first", "second"]) {
    await writeFile(path.join(feed.holds, `${run}.json`), JSON.stringify({ run, startedAt: now, expiresAt: now + 60_000 }));
  }
  assert.equal(await updater.check(), "waiting");
  await rm(path.join(feed.holds, "first.json"));
  assert.equal(await updater.check(), "waiting");
  await writeFile(path.join(feed.holds, "second.json"), JSON.stringify({ run: "second", startedAt: now - 60_000, expiresAt: now - 1 }));
  await writeFile(path.join(feed.holds, "broken.json"), "{");
  await writeFile(path.join(feed.holds, "unbounded.json"), JSON.stringify({ run: "unbounded", startedAt: now, expiresAt: now + 7 * 60 * 60_000 }));
  assert.equal(await updater.check(), "restarting");
});

test("4.12 an explicit install overrides a run hold but still waits for a seed", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.2";
  let writing = true;
  let launches = 0;
  const updater = feed.updater(async () => { launches++; }, async () => !writing);
  await mkdir(feed.holds);
  await writeFile(path.join(feed.holds, "trial.json"), JSON.stringify({ run: "trial", startedAt: Date.now(), expiresAt: Date.now() + 60_000 }));
  updater.request("install");
  assert.equal(await updater.check(), "waiting");
  assert.equal(launches, 0);
  writing = false;
  assert.equal(await updater.check(), "restarting");
  assert.equal(launches, 1);
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
  const state = { version: "0.3.1", stable: undefined as string | undefined, offline: false, corrupt: false, downloads: 0, installer };
  const server = createServer((request, response) => {
    if (state.offline) { response.writeHead(404).end(); return; }
    if (request.url?.startsWith("/stable/latest.yml")) {
      if (!state.stable) { response.writeHead(404).end(); return; }
      response.end(JSON.stringify({ version: state.stable, files: [{ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/setup.exe`, size: installer.length, sha512: createHash("sha512").update(installer).digest("base64") }] }));
    } else if (request.url?.startsWith("/latest.yml")) {
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
    holds: path.join(dir, "update-holds"),
    updater(restart: (target: Launch, showing: boolean) => Promise<void>, canRestart: () => Promise<boolean>, quiet = async () => true, channel?: "stable" | "development") {
      const updater = new ReleaseUpdater({ restart, canRestart, quiet, home: dir, ...(channel ? { releaseChannel: () => channel } : {}) }, {
        version: "0.3.1", name: "storytree-test", isPackaged: true,
        appUpdateConfigPath: config, userDataPath: dir, baseCachePath: dir,
        whenReady: async () => {}, relaunch: () => assert.fail("separate relaunch"),
        quit: () => assert.fail("separate quit"), onQuit: () => assert.fail("install-on-quit bypasses lifecycle"),
      });
      // Replace only Electron's network transport, retaining its file download and digest checks.
      const transport = new NodeHttpExecutor();
      const executor = Object.assign(new ElectronHttpExecutor(), { createRequest(options: Parameters<typeof transport.createRequest>[0], callback: Parameters<typeof transport.createRequest>[1]) {
        if (options.hostname === "raw.githubusercontent.com") {
          options = { ...options, protocol: "http:", hostname: "127.0.0.1", port: address.port, path: `/stable/${String(options.path).split("/").at(-1)}` };
        }
        return transport.createRequest(options, callback);
      } });
      Object.assign(updater, { httpExecutor: executor, _testOnlyOptions: { platform: "win32" } });
      updater.logger = null;
      updater.disableDifferentialDownload = true;
      return updater;
    },
  });
}
