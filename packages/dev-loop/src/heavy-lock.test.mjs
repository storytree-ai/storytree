// increment_d8c91507b3a1 / increment_8610446d96b6: heavy runs on one machine queue behind a named
// lock in STORYTREE_HOME, taken by the test harness itself, instead of saturating the machine.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { runHeavyCommand } from "./heavy-lock.mjs";
import { killTree } from "./unit-run.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function machine(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "heavy-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, "home");
  const log = path.join(dir, "runs.log");
  const file = path.join(dir, "slow.test.mjs");
  writeFileSync(
    file,
    `import { test } from "node:test"; import { appendFileSync } from "node:fs";
test("slow", async () => {
  appendFileSync(${JSON.stringify(log)}, \`start \${process.env.RUN} \${Date.now()}\\n\`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  appendFileSync(${JSON.stringify(log)}, \`end \${process.env.RUN} \${Date.now()}\\n\`);
});`,
  );
  const env = { ...process.env, STORYTREE_HOME: home, STORYTREE_TEST_PG_URL: "postgres://unused" };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER; // this suite itself runs under the outer run's lock
  const harness = (run) => {
    const child = spawn(process.execPath, ["--import", "tsx", "packages/dev-loop/src/test.mjs", file], { cwd: root, env: { ...env, RUN: run }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const done = new Promise((resolve) => child.once("close", (code) => resolve({ code, output })));
    return { child, done };
  };
  const events = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map((line) => {
          const [what, run, at] = line.split(" ");
          return { what, run, at: Number(at) };
        })
      : [];
  return { home, harness, events };
}

test("6.2 a second test run on the machine waits for the first, naming who holds the lock", async (t) => {
  const { harness, events } = machine(t);
  const first = harness("first");
  while (!events().some((event) => event.what === "start")) await delay(50);
  const second = harness("second");
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.output);
  assert.equal(b.code, 0, b.output);
  const at = (what, run) => events().find((event) => event.what === what && event.run === run).at;
  assert.ok(at("start", "second") >= at("end", "first"), `the runs overlapped: ${JSON.stringify(events())}`);
  assert.match(b.output, new RegExp(`waiting for .*pid ${first.child.pid}`));
});

test("6.2 a lock whose holder has gone does not block the next run", async (t) => {
  const { home, harness } = machine(t);
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "heavy-run.lock"), JSON.stringify({ id: "old", pid: gone, branch: "gone-branch", since: new Date().toISOString() }));
  const run = await harness("only").done;
  assert.equal(run.code, 0, run.output);
  assert.match(run.output, /gone-branch.*gone/);
  assert.equal(existsSync(path.join(home, "heavy-run.lock")), false, "the lock is released on exit");
});

function commandMachine(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "heavy-command-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, STORYTREE_HOME: dir };
  delete env.STORYTREE_HEAVY_LOCK_HOLDER;
  const start = (args, extraEnv = {}) => {
    const child = spawn(process.execPath, args, { cwd: dir, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => resolve({ code, output }));
    });
    t.after(async () => { killTree(child); await done; });
    return { child, done, output: () => output };
  };
  const wrapper = (...args) => start([path.join(root, "packages/dev-loop/src/heavy-lock.mjs"), "--", ...args]);
  return { dir, start, wrapper };
}

async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await delay(25);
  }
  assert.fail("command did not reach the expected state within five seconds");
}

test("6.2 a browser evidence command waits behind the foreground gate, names its holder and starts after release", { timeout: 15_000 }, async (t) => {
  const { dir, start, wrapper } = commandMachine(t);
  // Hold the real gate in its typecheck step, without running another full test suite.
  const manager = path.join(dir, "manager.mjs");
  writeFileSync(manager, "console.log('typecheck holding'); setInterval(() => {}, 1000);");
  // Windows kill(SIGINT) terminates Node outright; emit the gate's signal locally so its
  // normal cancellation also stops the typecheck child before giving up the hold.
  const cancel = path.join(dir, "cancel.mjs");
  const stopFile = path.join(dir, "stop-gate");
  writeFileSync(cancel, `
    import { existsSync } from 'node:fs';
    const timer = setInterval(() => {
      if (existsSync(${JSON.stringify(stopFile)})) { clearInterval(timer); process.emit('SIGINT'); }
    }, 25);
    timer.unref();
  `);
  const gate = start(["--import", pathToFileURL(cancel).href, path.join(root, "packages/dev-loop/src/gate.mjs")], { npm_execpath: manager });
  await until(() => gate.output().includes("typecheck holding"));
  const capture = wrapper(process.execPath, "-e", "console.log('capture started')");
  await until(() => /waiting for/.test(capture.output()));
  assert.match(capture.output(), new RegExp(`pid ${gate.child.pid}`));
  assert.doesNotMatch(capture.output(), /capture started/);
  writeFileSync(stopFile, "stop");
  assert.equal((await gate.done).code, 130);
  const result = await capture.done;
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /capture started/);
  assert.equal(existsSync(path.join(dir, "heavy-run.lock")), false);
});

test("6.2 a locked command preserves arguments, cwd and failure status, inherits its hold and takes over a stale holder", { timeout: 10_000 }, async (t) => {
  const { dir, wrapper } = commandMachine(t);
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  writeFileSync(path.join(dir, "heavy-run.lock"), JSON.stringify({ id: "gone", pid: gone, branch: "old-capture" }));
  const script = path.join(dir, "capture with spaces.mjs");
  writeFileSync(script, `
    import { acquireHeavyLock } from ${JSON.stringify(new URL("./heavy-lock.mjs", import.meta.url).href)};
    const release = await acquireHeavyLock({ root: process.cwd(), what: 'nested', waitMs: 0 });
    console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
    release();
    process.exitCode = 7;
  `);
  const args = ["--", "two words", 'a"b', "$literal", "a;b"];
  const result = await wrapper(process.execPath, script, ...args).done;
  assert.equal(result.code, 7, result.output);
  assert.match(result.output, /old-capture.*gone/);
  assert.deepEqual(JSON.parse(result.output.trim().split("\n").at(-1)), { args, cwd: realpathSync(dir) });
  assert.equal(existsSync(path.join(dir, "heavy-run.lock")), false);
  const missing = await wrapper(path.join(dir, "missing-command")).done;
  assert.equal(missing.code, 1, missing.output);
  assert.match(missing.output, /ENOENT/);
  assert.equal(existsSync(path.join(dir, "heavy-run.lock")), false);
});

test("6.2 cancelling a waiting capture starts no command and leaves the current holder alone", { timeout: 10_000, skip: process.platform === "win32" && "platform:posix: Windows cannot send a catchable signal to another Node process" }, async (t) => {
  const { dir, start, wrapper } = commandMachine(t);
  const holder = start(["--input-type=module", "-e", `
    import { acquireHeavyLock } from ${JSON.stringify(new URL("./heavy-lock.mjs", import.meta.url).href)};
    await acquireHeavyLock({ root: process.cwd(), what: 'holder' });
    console.log('holding'); setInterval(() => {}, 1000);
  `]);
  await until(() => holder.output().includes("holding"));
  const before = readFileSync(path.join(dir, "heavy-run.lock"), "utf8");
  const capture = wrapper(process.execPath, "-e", "console.log('must not start')");
  await until(() => /waiting for/.test(capture.output()));
  capture.child.kill("SIGINT");
  const result = await capture.done;
  assert.equal(result.code, 130, result.output);
  assert.doesNotMatch(result.output, /must not start/);
  assert.equal(readFileSync(path.join(dir, "heavy-run.lock"), "utf8"), before);
});

test("6.2 cancelling a running capture stops its child tree before releasing the hold", { timeout: 15_000 }, async (t) => {
  const { dir } = commandMachine(t);
  const previous = process.env.STORYTREE_HOME;
  const previousHolder = process.env.STORYTREE_HEAVY_LOCK_HOLDER;
  process.env.STORYTREE_HOME = dir;
  delete process.env.STORYTREE_HEAVY_LOCK_HOLDER;
  const controller = new AbortController();
  const pids = [];
  t.after(() => {
    controller.abort();
    if (previous === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = previous;
    if (previousHolder !== undefined) process.env.STORYTREE_HEAVY_LOCK_HOLDER = previousHolder;
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
  });
  writeFileSync(path.join(dir, "capture.mjs"), `
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    writeFileSync('capture.pid', String(process.pid));
    spawn(process.execPath, ['browser.mjs'], { stdio: 'inherit' });
    setInterval(() => {}, 1000);
  `);
  writeFileSync(path.join(dir, "browser.mjs"), `
    import { writeFileSync } from 'node:fs';
    writeFileSync('browser.pid', String(process.pid));
    setInterval(() => {}, 1000);
  `);
  const running = runHeavyCommand(process.execPath, ["capture.mjs"], { root: dir, signal: controller.signal });
  for (const file of ["capture.pid", "browser.pid"]) {
    await until(() => existsSync(path.join(dir, file)));
    pids.push(Number(readFileSync(path.join(dir, file), "utf8")));
  }
  controller.abort();
  assert.equal(await running, 130);
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await until(() => pids.every(pid => !alive(pid)));
  assert.equal(existsSync(path.join(dir, "heavy-run.lock")), false);
});

// increment_b280164800d5: waiters are admitted in arrival order, so an older live waiter is never
// passed over by later runs, and a waiter that died or gave up never wedges the ones behind it.
function queueMachine(t) {
  const { dir, start } = commandMachine(t);
  const order = path.join(dir, "order.log");
  const runner = path.join(dir, "runner.mjs");
  writeFileSync(runner, `
    import { appendFileSync, existsSync } from 'node:fs';
    import { acquireHeavyLock } from ${JSON.stringify(new URL("./heavy-lock.mjs", import.meta.url).href)};
    const [name, pollMs, waitMs] = process.argv.slice(2);
    let release;
    try {
      release = await acquireHeavyLock({ root: process.cwd(), what: name, pollMs: Number(pollMs), waitMs: Number(waitMs) });
    } catch (error) { console.log('gave up: ' + error.message); process.exit(3); }
    appendFileSync(${JSON.stringify(order)}, name + '\\n');
    console.log('holding ' + name);
    const timer = setInterval(() => { if (existsSync('stop-' + name)) { clearInterval(timer); release(); } }, 25);
  `);
  const run = (name, { pollMs = 25, waitMs = 60_000 } = {}) => start([runner, name, String(pollMs), String(waitMs)]);
  const admitted = () => (existsSync(order) ? readFileSync(order, "utf8").trim().split("\n") : []);
  const stop = (name) => writeFileSync(path.join(dir, `stop-${name}`), "");
  return { dir, run, admitted, stop };
}

test("6.2 an older waiter takes the lock before a later arrival, however often the later one polls", { timeout: 20_000 }, async (t) => {
  const { run, admitted, stop } = queueMachine(t);
  const holder = run("holder");
  await until(() => holder.output().includes("holding holder"));
  // The older waiter polls slowly and the later one fast: a race would go to the later one.
  const older = run("older", { pollMs: 1500 });
  await until(() => /waiting for/.test(older.output()));
  const later = run("later", { pollMs: 10 });
  await until(() => /waiting for/.test(later.output()));
  stop("holder");
  await until(() => admitted().length === 2);
  assert.deepEqual(admitted(), ["holder", "older"]);
  stop("older");
  await until(() => admitted().length === 3);
  assert.deepEqual(admitted(), ["holder", "older", "later"]);
  stop("later");
  for (const child of [holder, older, later]) assert.equal((await child.done).code, 0, child.output());
});

test("6.2 waiters that died or gave up do not hold back the runs that came after them", { timeout: 20_000 }, async (t) => {
  const { dir, run, admitted, stop } = queueMachine(t);
  const holder = run("holder");
  await until(() => holder.output().includes("holding holder"));
  // A waiter from a process that has gone, queued before anyone here.
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  const queue = path.join(dir, "heavy-run.queue");
  mkdirSync(queue, { recursive: true });
  writeFileSync(path.join(queue, "0000000000001-ghost.json"), JSON.stringify({ id: "ghost", pid: gone }));
  // One whose pid now names a live process, but that its waiter stopped refreshing long ago.
  const reused = path.join(queue, "0000000000002-reused.json");
  writeFileSync(reused, JSON.stringify({ id: "reused", pid: process.pid }));
  const longAgo = new Date(Date.now() - 10 * 60_000);
  utimesSync(reused, longAgo, longAgo);
  const killed = run("killed");
  await until(() => /waiting for/.test(killed.output()));
  const impatient = run("impatient", { waitMs: 200 });
  const late = run("late");
  await until(() => /waiting for/.test(late.output()));
  killed.child.kill("SIGKILL");
  await killed.done;
  assert.equal((await impatient.done).code, 3, impatient.output());
  stop("holder");
  await until(() => admitted().length === 2);
  assert.deepEqual(admitted(), ["holder", "late"]);
  stop("late");
  assert.equal((await late.done).code, 0, late.output());
  await until(() => !existsSync(path.join(dir, "heavy-run.lock")));
  assert.deepEqual(readdirSync(queue), [], "every ticket is gone once its run is");
});
