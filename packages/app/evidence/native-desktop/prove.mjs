// Actual Linux Electron acceptance for App 1.7 and 4.10. Run after desktop:build,
// with DISPLAY pointing at a disposable X server. The home/database are throwaway.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireHeavyLock } from "../../../dev-loop/src/heavy-lock.mjs";
import { recordBrowserCoverage } from "../../../dev-loop/src/survey-coverage.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const desktop = path.join(root, "apps/desktop");
const desktopRequire = createRequire(path.join(desktop, "package.json"));
const { chromium } = desktopRequire("playwright-core");
const electron = desktopRequire("electron");
const pkgDir = path.join(root, "packages/app");
const lifecycleProof = "app 1.7 native close, reopen and quit retain then stop the database";
const updateProof = "app 4.10 native checkout update request refuses without fetching or restarting";
assert.equal(process.platform, "linux", "this acceptance run witnesses Linux Electron");
assert.ok(process.env.DISPLAY, "use a disposable X server");
const release = await acquireHeavyLock({ root, what: "native Desktop lifecycle acceptance" });
const home = await mkdtemp(path.join(tmpdir(), "storytree-native-desktop-"));
const env = { ...process.env, STORYTREE_HOME: home, STORYTREE_EMBEDDER: "off" };
delete env.ELECTRON_RUN_AS_NODE;
const flags = ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
let child, browser, inspector, renderer, log = "", closed, passed = false;
const children = [];
const observations = { platform: process.platform, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() };
const digest = value => createHash("sha256").update(value).digest("hex");

async function until(read, message, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result;
    await delay(50);
  }
  throw new Error(`${message}\n${log}`);
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const answer = JSON.parse(data);
    const waiter = pending.get(answer.id);
    if (!waiter) return;
    pending.delete(answer.id);
    answer.error ? waiter.reject(new Error(JSON.stringify(answer.error))) : waiter.resolve(answer.result);
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function evaluate(expression) {
  const answer = await inspector.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
  return answer.result.value;
}

function launch(args) {
  const process = spawn(electron, [desktop, ...flags, ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.on("data", data => { log += data; });
  process.stderr.on("data", data => { log += data; });
  children.push(process);
  return process;
}

async function scripts(result, bundle, connection) {
  const bundlePath = path.join(desktop, "dist", bundle);
  const source = await readFile(bundlePath, "utf8");
  const sourceMap = JSON.parse(await readFile(`${bundlePath}.map`, "utf8"));
  const found = [];
  for (const script of result) {
    if (script.url !== pathToFileURL(bundlePath).href && script.url !== bundlePath) continue;
    const actual = await connection.send("Debugger.getScriptSource", { scriptId: script.scriptId });
    assert.equal(actual.scriptSource, source, `${bundle}: runtime source matches the saved source map`);
    found.push({ bundlePath, source, sourceMap, functions: script.functions });
  }
  assert.equal(found.length, 1, `one measured ${bundle} script`);
  return found;
}

try {
  child = launch(["--inspect-brk=0", "--remote-debugging-port=0", "--background"]);
  closed = once(child, "exit");
  const endpoint = await until(() => log.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1], "main inspector did not start");
  inspector = await connect(endpoint);
  await inspector.send("Profiler.enable");
  await inspector.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  await inspector.send("Runtime.runIfWaitingForDebugger");
  await until(() => log.includes("storytree 0.3:"), "app did not open its database");
  // The real main module supplies Electron; no lifecycle/update implementation is replaced.
  await evaluate('globalThis.__nativeProofElectron = process.mainModule.require("electron")');
  const windows = () => evaluate("__nativeProofElectron.BrowserWindow.getAllWindows().length");
  assert.equal(await windows(), 0, "background launch opens no window");
  const launchRecord = JSON.parse(await readFile(path.join(home, "app.json"), "utf8"));
  assert.equal(launchRecord.pid, child.pid);
  const pidFile = path.join(home, "pgdata/postmaster.pid");
  const databaseRecord = (await readFile(pidFile, "utf8")).split("\n");
  const databasePid = Number(databaseRecord[0]);
  const { Client } = createRequire(path.join(root, "package.json"))("pg");
  const queryDatabase = async () => {
    const client = new Client({ connectionString: `postgres://postgres@127.0.0.1:${databaseRecord[3]}/postgres` });
    await client.connect();
    try { assert.equal((await client.query("select 1 as alive")).rows[0].alive, 1); }
    finally { await client.end(); }
  };
  process.kill(databasePid, 0);
  await queryDatabase();
  observations.databasePid = databasePid;
  observations.backgroundLaunch = true;

  // A real second launch follows the native single-instance route to open the window.
  const second = launch([]);
  assert.equal((await once(second, "exit"))[0], 0);
  await until(async () => await windows() === 1, "second launch did not reopen the window");
  const browserEndpoint = await until(() => log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], "renderer CDP did not start");
  browser = await chromium.connectOverCDP(browserEndpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent("page");
  renderer = await context.newCDPSession(page);
  await renderer.send("Debugger.enable");
  await renderer.send("Profiler.enable");
  await renderer.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  // Reload under precise coverage so the actual sandboxed preload construction is measured too.
  await page.reload();
  await page.waitForFunction(() => typeof window.storytree?.checkForUpdates === "function");
  const update = await page.evaluate(() => window.storytree.checkForUpdates("check"));
  assert.equal(update.phase, "unavailable");
  assert.match(update.runningBuild, /checkout|does not update/i);
  assert.equal(child.exitCode, null);
  await assert.rejects(access(path.join(home, "runtime")), { code: "ENOENT" });
  observations.checkoutUpdate = update;
  const mainCoverage = await inspector.send("Profiler.takePreciseCoverage");
  const preloadCoverage = await renderer.send("Profiler.takePreciseCoverage");
  await inspector.send("Debugger.enable");
  const measured = [
    ...await scripts(mainCoverage.result, "main.cjs", inspector),
    ...await scripts(preloadCoverage.result, "preload.cjs", renderer),
  ];
  // Keep these measured inputs until the lifecycle assertions and graceful exit also pass.
  await evaluate("__nativeProofElectron.BrowserWindow.getAllWindows()[0].close()");
  await until(async () => await windows() === 0, "closing the window left it open");
  assert.equal(child.exitCode, null, "closing the window keeps the native app running");
  assert.equal(Number((await readFile(pidFile, "utf8")).split("\n")[0]), databasePid);
  process.kill(databasePid, 0);
  await queryDatabase();
  observations.closedIntoBackground = true;
  const reopened = launch([]);
  assert.equal((await once(reopened, "exit"))[0], 0);
  await until(async () => await windows() === 1, "reopening did not restore the window");
  assert.equal(Number((await readFile(pidFile, "utf8")).split("\n")[0]), databasePid);
  await queryDatabase();
  observations.reopenedSameDatabase = true;
  // Capture functions from close/reopen as a second real measurement, not fabricated weights.
  const reopenCoverage = await inspector.send("Profiler.takePreciseCoverage");
  const lifecycleScripts = [...measured, ...await scripts(reopenCoverage.result, "main.cjs", inspector)];
  inspector.close();
  inspector = undefined;
  const quit = launch(["--quit"]);
  assert.equal((await once(quit, "exit"))[0], 0);
  const exit = await Promise.race([closed, delay(15000, undefined, { ref: false }).then(() => { throw new Error("native quit did not finish within 15 s"); })]);
  assert.equal(exit[0], 0, log);
  await assert.rejects(access(pidFile), { code: "ENOENT" });
  assert.throws(() => process.kill(databasePid, 0), { code: "ESRCH" });
  assert.doesNotMatch(log, /library is closed|pool after calling end/i);
  observations.quitStoppedDatabase = true;
  observations.lifecycle = recordBrowserCoverage({ pkgDir, proof: lifecycleProof, passed: true, scripts: lifecycleScripts });
  observations.updates = recordBrowserCoverage({ pkgDir, proof: updateProof, passed: true, scripts: measured });
  observations.sources = {};
  for (const file of ["home.ts", "main/args.ts", "main/main.ts", "main/releases.ts", "main/tray-icon.ts", "preload/preload.ts", "bridge.ts"]) {
    observations.sources[`apps/desktop/src/${file}`] = digest(await readFile(path.join(desktop, "src", file)));
  }
  await writeFile(path.join(here, "functions.json"), JSON.stringify(lifecycleScripts.map(script => ({
    bundle: path.relative(root, script.bundlePath), sourceSha256: digest(script.source),
    sourceMapSha256: digest(JSON.stringify(script.sourceMap)),
    functions: script.functions.filter(fn => fn.ranges[0].count > 0),
  })), null, 1) + "\n");
  observations.passed = true;
  passed = true;
  await writeFile(path.join(here, "observations.json"), JSON.stringify(observations, null, 2) + "\n");
  console.log(JSON.stringify(observations, null, 2));
} finally {
  if (!passed) for (const proof of [lifecycleProof, updateProof]) {
    try { recordBrowserCoverage({ pkgDir, proof, passed: false, scripts: [] }); } catch { /* failed recaptures invalidate their prior input */ }
  }
  inspector?.close();
  await browser?.close().catch(() => {});
  for (const process of children) if (process.exitCode === null && process.signalCode === null) process.kill("SIGTERM");
  if (closed && child.exitCode === null && child.signalCode === null) await Promise.race([closed, delay(10000)]);
  await writeFile(path.join(here, "run.log"), log);
  if (children.every(process => process.exitCode !== null || process.signalCode !== null)) await rm(home, { recursive: true, force: true });
  release();
}
