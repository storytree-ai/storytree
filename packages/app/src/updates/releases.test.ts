import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import { NodeHttpExecutor } from "builder-util/out/nodeHttpExecutor.js";
import { AppImageUpdater, MacUpdater, NsisUpdater } from "electron-updater";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";

import { removeTemp } from "@storytree/test-waits";

import { background, type Launch } from "../lifecycle/background.js";
import { keepBackups } from "../lifecycle/backups.js";
import { ReleaseUpdater, releaseBase } from "./releases.js";
import { publishStable } from "./stable-github.js";
import { pinStable } from "./stable-pin.js";

type Platform = "win32" | "darwin" | "linux";
const PLATFORMS: readonly Platform[] = ["win32", "darwin", "linux"];
/**
 * AppImageUpdater replaces the AppImage with a POSIX `mv`, which a Windows host lacks; Linux and macOS hosts run these.
 * The skip names the platform the test needs (posix), so CI credits the Windows job's skip with the Linux and macOS passes.
 */
const hostRuns = (platform: Platform) => ({ skip: platform === "linux" && process.platform === "win32" ? "platform:posix: the AppImage install needs a POSIX mv, which Windows lacks" : false });

/**
 * Electron's Squirrel.Mac autoUpdater, which MacUpdater takes from require("electron"): it fetches
 * what MacUpdater's local server offers, as Squirrel does, and has no quit of its own to call.
 */
class Squirrel extends EventEmitter {
  staged: Buffer | undefined;
  private feed: { url: string; headers?: Record<string, string> } | undefined;
  setFeedURL(feed: { url: string; headers?: Record<string, string> }): void { this.feed = feed; }
  checkForUpdates(): void {
    void (async () => {
      const offer = await fetch(this.feed!.url, { headers: this.feed!.headers ?? {} });
      const { url } = await offer.json() as { url: string };
      this.staged = Buffer.from(await (await fetch(url)).arrayBuffer());
      this.emit("update-downloaded");
    })().catch((error: unknown) => this.emit("error", error));
  }
  quitAndInstall(): void { assert.fail("Squirrel's own quit bypasses the lifecycle"); }
}
const electron: { autoUpdater?: Squirrel } = {};
{
  const require = createRequire(createRequire(import.meta.url).resolve("electron-updater"));
  const id = require.resolve("electron");
  require.cache[id] = { id, filename: id, loaded: true, exports: electron } as NodeJS.Module;
}

test("4.15 stable downloads only the pinned artifact while alpha continues to advance; no stable feed never falls back", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.9";
  feed.stable = "0.3.2";
  const stable = feed.updater(async () => {}, async () => false, async () => false, "stable");
  const alpha = feed.updater(async () => {}, async () => false, async () => false, "alpha");
  assert.equal(await stable.check(), "waiting");
  assert.equal(stable.request("status").nextBuild, "0.3.2");
  assert.equal(await alpha.check(), "waiting");
  assert.equal(alpha.request("status").nextBuild, "0.3.9");
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

test("4.16 after stable moves back, an install on the bad build sees no update and one on an older build takes nothing newer than the pin", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.9";
  feed.stable = "0.3.2";
  feed.running = "0.3.3";
  let installed = 0;
  const onBad = feed.updater(async () => { installed++; }, async () => true, async () => true, "stable");
  assert.equal(await onBad.check(), "current");
  assert.equal(onBad.request("status").phase, "up-to-date");
  assert.equal(feed.downloads, 0);
  feed.running = "0.3.1";
  const older = feed.updater(async () => { installed++; }, async () => true, async () => true, "stable");
  assert.equal(await older.check(), "restarting");
  assert.equal(older.request("status").nextBuild, "0.3.2");
  assert.equal(installed, 1);
});

/** The stable branch exactly as a pin of `version` writes it, every file pointing at that release's own assets. */
async function pinnedBranch(installer: Buffer, version: string): Promise<Map<string, string>> {
  const at = (name: string) => `https://github.com/storytree-ai/storytree/releases/download/v${version}/storytree-0.3-${version}-${name}`;
  const digest = { sha512: createHash("sha512").update(installer).digest("base64"), size: installer.length };
  const manifest = await pinStable(version, {
    previous: async () => undefined,
    formerPin: async () => undefined,
    swept: async () => "question_pin: passed",
    candidate: async () => ({ version, commit: "a".repeat(40), channelSchema: 1, draft: false, prerelease: false,
      installers: ["x64", "arm64"].map(arch => ({ url: at(`windows-${arch}-setup.exe`), sha256: "a".repeat(64), ...digest })), bootstrap: { ps1: "bootstrap" },
      // An arch-neutral name: MacUpdater drops arm64 files on an Intel host, which this test may run on.
      feeds: { mac: { version, files: [{ url: at("mac.zip"), ...digest }] }, linux: { version, files: [{ url: at("linux-x86_64.AppImage"), ...digest }] } } }),
    pullRequests: async () => new Set(), increments: async () => [], publish: async () => {}, now: () => "2026-10-16T00:00:00.000Z",
  }, true);
  const branch = new Map<string, string>();
  await publishStable(manifest, { ps1: "bootstrap" }, undefined, async (endpoint, _method, body) => {
    if (endpoint === "git/trees") for (const file of (body as { tree: { path: string; content: string }[] }).tree) branch.set(file.path, file.content);
    return { sha: "sha" };
  });
  return branch;
}

test("4.15 a stable Windows, Mac and Linux install each take only the pinned build, Windows its own architecture's installer, from the feeds the pin wrote, while development moves on", async (t) => {
  const windowsFeed = await fixture(t, "win32");
  windowsFeed.version = "0.3.9";
  windowsFeed.stableBranch = await pinnedBranch(windowsFeed.installer, "0.3.2");
  const windows = windowsFeed.updater(async () => {}, async () => false, async () => false, "stable");
  assert.equal(await windows.check(), "waiting");
  assert.equal(windows.request("status").nextBuild, "0.3.2");
  assert.deepEqual(windowsFeed.fetched, [`/release/storytree-ai/storytree/releases/download/v0.3.2/storytree-0.3-0.3.2-windows-${process.arch}-setup.exe`]);

  const feed = await fixture(t, "darwin");
  feed.version = "0.3.9";
  feed.stableBranch = windowsFeed.stableBranch;
  const mac = feed.updater(async () => {}, async () => false, async () => false, "stable");
  assert.equal(await mac.check(), "waiting");
  assert.equal(mac.request("status").nextBuild, "0.3.2");
  assert.deepEqual(feed.fetched, ["/release/storytree-ai/storytree/releases/download/v0.3.2/storytree-0.3-0.3.2-mac.zip"]);

  const linuxFeed = await fixture(t, "linux");
  linuxFeed.version = "0.3.9";
  linuxFeed.stableBranch = feed.stableBranch;
  const linux = linuxFeed.updater(async () => {}, async () => false, async () => false, "stable");
  assert.equal(await linux.check(), "waiting");
  assert.equal(linux.request("status").nextBuild, "0.3.2");
  assert.deepEqual(linuxFeed.fetched, ["/release/storytree-ai/storytree/releases/download/v0.3.2/storytree-0.3-0.3.2-linux-x86_64.AppImage"]);
});

test("4.4 the platform picks the updater's base: NSIS on Windows, Squirrel.Mac on macOS, the AppImage's own on Linux, none elsewhere", () => {
  assert.equal(Object.getPrototypeOf(releaseBase("win32")), NsisUpdater);
  assert.equal(Object.getPrototypeOf(releaseBase("darwin")), MacUpdater);
  assert.equal(Object.getPrototypeOf(releaseBase("linux")), AppImageUpdater);
  for (const platform of ["freebsd", "aix"] as const) assert.equal(releaseBase(platform), undefined);
  assert.throws(() => new ReleaseUpdater({ restart: async () => {}, canRestart: async () => true, quiet: async () => true }, undefined, "freebsd"), /freebsd/);
});

for (const platform of PLATFORMS) {
  test(`4.4 ${platform}: an installed app downloads a newer release, waits for a seed, stops its database and restarts through ${{ win32: "NSIS", darwin: "Squirrel.Mac", linux: "the replaced AppImage" }[platform]}`, hostRuns(platform), async (t) => {
    const feed = await fixture(t, platform);
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
    // Squirrel.Mac first fetches the download from MacUpdater; then the database stops, before anything else.
    // A check that settles first (Squirrel could not stage) fails here rather than spinning the run forever.
    let settled = false;
    applying.then(() => { settled = true; }, () => { settled = true; });
    while (events.length === 0 && !settled) await new Promise((resolve) => setImmediate(resolve));
    if (events.length === 0) await applying;
    assert.deepEqual(events, ["stopping"]);
    finishStop();
    assert.equal(await applying, "restarting");
    assert.deepEqual(events, ["stopping", "stopped", "installer", "exit"]);
    if (platform === "win32") {
      assert.deepEqual(target?.args, ["--updated", "/S", "--force-run"]);
      assert.deepEqual(await readFile(target!.execPath), feed.installer);
    } else if (platform === "linux") {
      // The AppImage file was replaced in place, and the restart starts it; nothing ran it before the database stopped.
      assert.deepEqual(target, { execPath: feed.appImage, args: [] });
      assert.deepEqual(await readFile(feed.appImage), feed.installer);
    } else {
      // Squirrel.Mac staged the verified download; the relaunch opens the app once ShipIt has swapped it.
      assert.deepEqual(feed.squirrel?.staged, feed.installer);
      assert.equal(target?.execPath, "/bin/sh");
      assert.deepEqual(target?.args.slice(2), ["storytree-update", "/Applications/storytree 0.3.app"]);
    }
    assert.equal(feed.downloads, 1);
  });

  test(`4.4 ${platform}: a downloaded release waits for a quiet moment, says it is pending, and installs when the user asks`, hostRuns(platform), async (t) => {
    const feed = await fixture(t, platform);
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
    test(`4.8 ${platform}: the ${entry} release restart keeps its window open while a snapshot is being written`, hostRuns(platform), async (t) => {
      const feed = await fixture(t, platform);
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
      // The user's asked restart reads as waiting for the write, never as offered again.
      assert.equal(updater.request("status").phase, entry === "menu" ? "ready" : "pending");
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
}

test("4.4 linux: an AppImage its menu entry started with --no-sandbox, where the kernel blocks the sandbox, restarts the replaced AppImage with it", hostRuns("linux"), async (t) => {
  const feed = await fixture(t, "linux");
  feed.sandboxOff = true;
  feed.version = "0.3.2";
  const launches: Launch[] = [];
  const updater = feed.updater(async (target) => { launches.push(target); }, async () => true);
  assert.equal(await updater.check(), "restarting");
  assert.deepEqual(launches, [{ execPath: feed.appImage, args: ["--no-sandbox"] }]);
});

test("4.7 Check for updates checks the release feed now, shares a check already running, and says the app is up to date with its running build", async (t) => {
  const feed = await fixture(t);
  const updater = feed.updater(async () => assert.fail("nothing newer to install"), async () => true);
  const automatic = updater.check();
  updater.request("check");
  assert.equal(await automatic, "current");
  assert.equal(feed.checks, 1, "the asked check joined the automatic one");
  assert.deepEqual(updater.request("status"), { phase: "up-to-date", runningBuild: "0.3.1" });
  updater.request("check");
  while (updater.request("status").phase === "checking") await new Promise(resolve => setImmediate(resolve));
  assert.equal(feed.checks, 2, "asking again checks now");
  assert.equal(updater.request("status").phase, "up-to-date");
});

// Its title names no contract: its skip outside the child run would otherwise leave 4.7 not checked on every run.
const DELIBERATE = "STORYTREE_RELEASES_DELIBERATE_FAILURE";
test("deliberately failing while an automatic check runs", { skip: process.env[DELIBERATE] ? false : "other: fails on purpose, so it runs only in the child run of 4.7's test below" }, async (t) => {
  const feed = await fixture(t);
  const updater = feed.updater(async () => assert.fail("nothing newer to install"), async () => true);
  void updater.check();
  updater.request("check");
  assert.equal(updater.request("status").phase, "deliberately wrong");
});

test("4.7 a failed assertion while an automatic check runs ends the run with its failure reported", async () => {
  const run = await promisify(execFile)(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", "--test-name-pattern=deliberately failing", fileURLToPath(import.meta.url)], { env: { ...process.env, NODE_TEST_CONTEXT: undefined, [DELIBERATE]: "1" }, timeout: 20_000, encoding: "utf8" })
    .then(() => assert.fail("the deliberately failing test passed"), (error: { code?: number; killed?: boolean; stdout?: string }) => error);
  assert.equal(run.killed, false, "the run hung until the timeout killed it");
  assert.equal(run.code, 1);
  assert.match(run.stdout ?? "", /✖ deliberately failing/);
});

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

test("4.4 a restart the user asked for while a seed was writing says it waits, and goes as soon as the seed ends, with no further check", async (t) => {
  const feed = await fixture(t);
  feed.version = "0.3.2";
  feed.recheck = 10;
  let writing = false;
  let launches = 0;
  const updater = feed.updater(async () => { launches++; }, async () => !writing, async () => false);
  t.after(() => updater.stop());
  assert.equal(await updater.check(), "waiting");
  assert.equal(updater.request("status").phase, "pending");
  // Downloaded: from here the updater's own clock is the test's.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  writing = true;
  assert.equal(updater.request("install").phase, "restarting", "the click reads as taken at once");
  await settle();
  assert.equal(updater.request("status").phase, "ready", "held, not offered again");
  t.mock.timers.tick(10);
  await settle();
  assert.equal(launches, 0, "still held while the seed writes");
  writing = false;
  t.mock.timers.tick(10);
  await settle();
  assert.equal(launches, 1);
});

for (const platform of PLATFORMS) {
  test(`4.5 ${platform}: a failed feed or corrupt download leaves the app running and can be retried; equal and older releases never restart it`, hostRuns(platform), async (t) => {
    const feed = await fixture(t, platform);
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

  test(`4.5 ${platform}: repeated checks share one download and quitting prevents a pending install`, hostRuns(platform), async (t) => {
    const feed = await fixture(t, platform);
    feed.version = "0.3.2";
    const updater = feed.updater(async () => { assert.fail("must not restart after stopping updates"); }, async () => false);
    assert.deepEqual(await Promise.all([updater.check(), updater.check()]), ["waiting", "waiting"]);
    assert.equal(feed.downloads, 1);
    updater.stop();
    assert.equal(await updater.check(), "stopped");
  });
}

test("4.24 a channel switch takes effect on the next check: the other channel's download is dropped and the running build is never downgraded", async (t) => {
  const feed = await fixture(t);
  feed.running = "0.3.5";
  feed.version = "0.3.9";
  feed.stable = "0.3.2";
  let channel: "stable" | "alpha" = "alpha";
  const updater = feed.updater(async () => assert.fail("no quiet moment, so no restart"), async () => true, async () => false, () => channel);
  assert.equal(await updater.check(), "waiting");
  assert.equal(updater.request("status").nextBuild, "0.3.9");
  channel = "stable";
  assert.equal(await updater.check(), "current", "stable's 0.3.2 is older than the running build, which stays");
  assert.equal(updater.request("status").phase, "up-to-date");
  assert.equal(updater.request("status").nextBuild, undefined, "alpha's download is not offered on stable");
  feed.stable = "0.3.7";
  assert.equal(await updater.check(), "waiting");
  assert.equal(updater.request("status").nextBuild, "0.3.7");
  channel = "alpha";
  assert.equal(await updater.check(), "waiting");
  assert.equal(updater.request("status").nextBuild, "0.3.9", "back on alpha, its own feed again");
});

test("4.27 a Windows update downloads only its changed blocks and verifies, even after an earlier downloaded update was never installed", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "storytree-differential-"));
  t.after(() => removeTemp(dir));
  // Three builds of 64 blocks; each changes a few blocks of the one before. 0.3.1 is installed.
  const block = 1024;
  const builds = new Map<string, Buffer>();
  let bytes = Buffer.alloc(64 * block);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + (i >> 10)) & 0xff;
  for (const [version, changed] of [["0.3.1", []], ["0.3.2", [3, 40]], ["0.3.3", [10, 41]]] as const) {
    bytes = Buffer.from(bytes);
    for (const at of changed) bytes.fill(Number(version.at(-1)), at * block, (at + 1) * block);
    builds.set(version, bytes);
  }
  // electron-updater only compares a blockmap's checksums with another's, so any digest of each block serves.
  const blockmap = (file: Buffer) => {
    const blocks = Array.from({ length: file.length / block }, (_, i) => file.subarray(i * block, (i + 1) * block));
    return gzipSync(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0, checksums: blocks.map(b => createHash("sha256").update(b).digest("base64")), sizes: blocks.map(b => b.length) }] }));
  };
  const feed = { version: "0.3.2", whole: 0, ranges: 0 };
  const server = createServer((request, response) => {
    const url = request.url?.split("?")[0] ?? "";
    const named = /^\/storytree-(\d+\.\d+\.\d+)-setup\.exe(\.blockmap)?$/.exec(url);
    const build = named ? builds.get(named[1]!) : undefined;
    if (url === "/latest.yml") {
      const file = builds.get(feed.version)!;
      response.end(JSON.stringify({ version: feed.version, files: [{ url: `storytree-${feed.version}-setup.exe`, size: file.length, sha512: createHash("sha512").update(file).digest("base64") }] }));
    } else if (build === undefined) response.writeHead(404).end();
    else if (named![2]) response.end(blockmap(build));
    else {
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      if (range === null) { feed.whole++; response.end(build); return; }
      feed.ranges++;
      const [start, end] = [Number(range[1]), Number(range[2])];
      response.writeHead(206, { "content-range": `bytes ${start}-${end}/${build.length}`, "content-length": end - start + 1 }).end(build.subarray(start, end + 1));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const config = path.join(dir, "app-update.yml");
  await writeFile(config, JSON.stringify({ provider: "generic", url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, updaterCacheDirName: "updates", useMultipleRangeRequest: false }));
  // NSIS keeps the installer that installed the running build in the updater's cache, as the old file of the next update.
  await mkdir(path.join(dir, "updates"), { recursive: true });
  await writeFile(path.join(dir, "updates", "installer.exe"), builds.get("0.3.1")!);
  // Each start of the app runs a fresh updater on 0.3.1, which never installs (no quiet moment).
  const session = () => {
    const updater = new ReleaseUpdater({ restart: async () => assert.fail("no quiet moment, so no restart"), canRestart: async () => true, quiet: async () => false, home: dir }, {
      version: "0.3.1", name: "storytree-test", isPackaged: true, appUpdateConfigPath: config, userDataPath: dir, baseCachePath: dir,
      whenReady: async () => {}, relaunch: () => assert.fail("separate relaunch"), quit: () => assert.fail("separate quit"), onQuit: () => {},
    }, "win32");
    t.after(() => updater.stop());
    // Electron's network transport is replaced by Node's; a failed differential download throws in test mode rather than falling back.
    Object.assign(updater.base, { httpExecutor: Object.assign(new ElectronHttpExecutor(), { createRequest: new NodeHttpExecutor().createRequest }), _testOnlyOptions: { platform: "win32", isUseDifferentialDownload: true } });
    updater.logger = null;
    return updater;
  };
  assert.equal(await session().check(), "waiting");
  assert.equal(pendingInstaller(dir, "0.3.2"), true);
  assert.deepEqual([feed.whole, feed.ranges > 0], [0, true], "0.3.2 came in blocks");
  // 0.3.2 was downloaded, never installed; 0.3.3 is published and the app starts again on 0.3.1.
  feed.version = "0.3.3";
  feed.ranges = 0;
  assert.equal(await session().check(), "waiting");
  assert.equal(pendingInstaller(dir, "0.3.3"), true);
  assert.deepEqual([feed.whole, feed.ranges > 0], [0, true], "0.3.3 came in blocks, rebuilt from the installed 0.3.1, and verified");
});

/** Whether the updater's pending download is this build's installer. */
function pendingInstaller(dir: string, version: string): boolean {
  return existsSync(path.join(dir, "updates", "pending", `storytree-${version}-setup.exe`));
}

/** A real local feed and electron-updater's real download/checksum path; no installer is executed. */
async function fixture(t: test.TestContext, platform: Platform = "win32") {
  const dir = await mkdtemp(path.join(tmpdir(), "storytree-release-"));
  // Every step runs, last added first, even when one fails: node:test skips the hooks after a failed
  // one, and a check still writing into dir when an assertion throws would leave the feed server
  // holding the run open, with no failure reported.
  const teardown: (() => unknown)[] = [() => removeTemp(dir)];
  t.after(async () => {
    const errors: unknown[] = [];
    for (const step of teardown.reverse()) { try { await step(); } catch (error) { errors.push(error); } }
    if (errors.length > 0) throw errors[0];
  });
  const installer = Buffer.from("fixture release payload — never executed");
  const state = { version: "0.3.1", running: "0.3.1", stable: undefined as string | undefined, stableBranch: undefined as Map<string, string> | undefined, fetched: [] as string[], offline: false, corrupt: false, checks: 0, downloads: 0, installer, squirrel: undefined as Squirrel | undefined, sandboxOff: false, recheck: undefined as number | undefined };
  const files = (base = "") => ["setup.exe", "storytree-mac.zip", "storytree-linux.AppImage"].map(url => ({ url: `${base}${url}`, size: installer.length, sha512: createHash("sha512").update(installer).digest("base64") }));
  const server = createServer((request, response) => {
    if (state.offline) { response.writeHead(404).end(); return; }
    if (state.stableBranch && request.url?.startsWith("/stable/")) {
      const file = state.stableBranch.get(request.url.slice("/stable/".length).split("?")[0]!);
      if (file === undefined) response.writeHead(404).end();
      else response.end(file);
    } else if (request.url?.startsWith("/release/")) {
      state.fetched.push(request.url);
      response.end(installer);
    } else if (request.url?.startsWith("/stable/latest.yml")) {
      if (!state.stable) { response.writeHead(404).end(); return; }
      response.end(JSON.stringify({ version: state.stable, files: files(`http://127.0.0.1:${(server.address() as { port: number }).port}/`) }));
    } else if (/^\/latest(-mac|-linux)?\.yml/.test(request.url ?? "")) {
      state.checks++;
      response.end(JSON.stringify({ version: state.version, files: files() }));
    } else if (request.url === "/setup.exe" || request.url === "/storytree-mac.zip" || request.url === "/storytree-linux.AppImage") {
      state.downloads++;
      response.end(state.corrupt ? Buffer.from("broken payload") : installer);
    } else response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  teardown.push(() => new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  // A Linux app runs from its AppImage, which the AppImage runtime names in APPIMAGE and the install replaces.
  const appImage = path.join(dir, "storytree-0.3");
  if (platform === "linux") {
    await writeFile(appImage, "the running build");
    const environment = { APPIMAGE: process.env["APPIMAGE"], TEST_UPDATER_ARCH: process.env["TEST_UPDATER_ARCH"] };
    teardown.push(() => { for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    Object.assign(process.env, { APPIMAGE: appImage, TEST_UPDATER_ARCH: "x64" });
  }
  const config = path.join(dir, "app-update.yml");
  await writeFile(config, JSON.stringify({ provider: "generic", url: `http://127.0.0.1:${address.port}`, updaterCacheDirName: "updates" }));
  // Replace only Electron's network transport, retaining its file download and digest checks.
  const executor = () => {
    const transport = new NodeHttpExecutor();
    return Object.assign(new ElectronHttpExecutor(), { createRequest(options: Parameters<typeof transport.createRequest>[0], callback: Parameters<typeof transport.createRequest>[1]) {
      if (options.hostname === "raw.githubusercontent.com") {
        options = { ...options, protocol: "http:", hostname: "127.0.0.1", port: address.port, path: `/stable/${String(options.path).split("/").at(-1)}` };
      } else if (options.hostname === "github.com") {
        options = { ...options, protocol: "http:", hostname: "127.0.0.1", port: address.port, path: `/release${String(options.path)}` };
      }
      return transport.createRequest(options, callback);
    } });
  };
  return Object.assign(state, {
    holds: path.join(dir, "update-holds"),
    appImage,
    updater(restart: (target: Launch, showing: boolean) => Promise<void>, canRestart: () => Promise<boolean>, quiet = async () => true, channel?: "stable" | "alpha" | (() => "stable" | "alpha")) {
      if (platform === "darwin") electron.autoUpdater = state.squirrel = new Squirrel();
      const updater = new ReleaseUpdater({ restart, canRestart, quiet, home: dir, bundle: "/Applications/storytree 0.3.app", sandboxOff: state.sandboxOff, ...(state.recheck === undefined ? {} : { recheck: state.recheck }), ...(channel ? { releaseChannel: typeof channel === "function" ? channel : () => channel } : {}) }, {
        version: state.running, name: "storytree-test", isPackaged: true,
        appUpdateConfigPath: config, userDataPath: dir, baseCachePath: dir,
        whenReady: async () => {}, relaunch: () => assert.fail("separate relaunch"),
        quit: () => assert.fail("separate quit"), onQuit: () => assert.fail("install-on-quit bypasses lifecycle"),
      }, platform);
      // MacUpdater serves the download to Squirrel.Mac from its own local server.
      teardown.push(() => { updater.stop(); const proxy = (updater.base as unknown as { server?: Server }).server; proxy?.closeAllConnections(); proxy?.close(); });
      Object.assign(updater.base, { httpExecutor: executor(), _testOnlyOptions: { platform } });
      updater.logger = null;
      updater.base.disableDifferentialDownload = true;
      return updater;
    },
  });
}
