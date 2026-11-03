import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp, waitUntil } from "@storytree/test-waits";

import { alive, keepRunning, outsideHost, poolService } from "./services.mjs";

async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "pool-services-"));
  t.after(() => removeTemp(path));
  return path;
}

/** A process the fakes below stand for: its pid, ended by `end`. */
function processes() {
  const live = new Set();
  let next = 100;
  return { live, start: () => { live.add(++next); return next; }, end: (pid) => live.delete(pid), isAlive: (pid) => live.has(pid) };
}

test("3.33 · the dispatcher's and watcher's service adopts the one already running, starts one when none runs and again after it ends, holds it while held says why, and on its stop leaves the one running", async () => {
  const stopping = new AbortController();
  const box = processes();
  const lines = [];
  let pidFile = 7, why = "pool-stop is there", turns = 0;
  box.live.add(7);
  const left = [];
  const sleep = async () => {
    turns += 1;
    if (turns === 1) box.end(7); // the adopted dispatcher ends
    if (turns === 3) why = undefined; // pool-stop goes
    if (turns === 5) box.end(101); // the one it started ends
    if (turns === 8) stopping.abort();
  };
  await keepRunning({
    name: "dispatcher", stopping: stopping.signal, log: (line) => lines.push(line), sleep, isAlive: box.isAlive,
    running: async () => { const pid = pidFile; pidFile = undefined; return pid; },
    held: async () => why, start: async () => box.start(), leave: async (pid) => { left.push(pid); box.end(pid); },
  });
  assert.deepEqual(lines, [
    "the dispatcher is already running (pid 7): keeping it",
    "the dispatcher (pid 7) ended: starting it again in 60 s",
    "the dispatcher is left stopped: pool-stop is there",
    "started the dispatcher (pid 101)",
    "the dispatcher (pid 101) ended: starting it again in 60 s",
    "started the dispatcher (pid 102)",
    "stopped the dispatcher (pid 102)",
  ]);
  assert.deepEqual(left, [102], "only the running one is left on the stop");
});

test("3.33 · under systemd on Linux the service starts its process in a scope of its own, outside the host's unit; elsewhere as it is", () => {
  const node = ["/usr/bin/node", ["launch.mjs", "pool"]];
  assert.deepEqual(outsideHost(node, { env: { INVOCATION_ID: "abc" }, platform: "linux" }),
    ["systemd-run", ["--user", "--scope", "--quiet", "--collect", "/usr/bin/node", "launch.mjs", "pool"]]);
  assert.deepEqual(outsideHost(node, { env: {}, platform: "linux" }), node);
  assert.deepEqual(outsideHost(node, { env: { INVOCATION_ID: "abc" }, platform: "win32" }), node);
});

// A dispatcher as the lane runner makes one: its lane in a process group of its own, which a SIGTERM to the dispatcher
// is forwarded to, as runner.mjs forwards it to its engine.
const FAKE_DISPATCHER = `
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const lanes = process.argv[3];
writeFileSync(lanes + "/pool.pid", String(process.pid));
const lane = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });
lane.unref();
writeFileSync(lanes + "/lane.pid", String(lane.pid));
process.on("SIGTERM", () => { try { process.kill(lane.pid, "SIGTERM"); } catch {} process.exit(0); });
setInterval(() => {}, 1000);
`;

test("3.33 · stopping the dispatcher's service ends the dispatcher and leaves its running lane running", async (t) => {
  const lanesDir = await folder(t);
  const script = join(lanesDir, "launch.mjs");
  await writeFile(script, FAKE_DISPATCHER);
  const stopping = new AbortController();
  const lines = [];
  const service = poolService("dispatcher", { lanesDir, checkout: lanesDir, command: [process.execPath, [script, "pool", lanesDir]], pollMs: 50, argsOf: async () => "launch.mjs pool" });
  const running = service.start({ stopping: stopping.signal, log: (line) => lines.push(line) });
  const lane = Number(await waitUntil(async () => (await readFile(join(lanesDir, "lane.pid"), "utf8").catch(() => "")), 10_000, "the fake lane's pid"));
  const dispatcherPid = Number(await readFile(join(lanesDir, "pool.pid"), "utf8"));
  t.after(() => { try { process.kill(lane); } catch {} });
  stopping.abort();
  await running;
  await waitUntil(() => !alive(dispatcherPid), 10_000, "the dispatcher to end");
  assert.equal(alive(lane), true, "the lane runs on after its dispatcher's service stopped");
  assert.match(lines.join("\n"), new RegExp(`stopped the dispatcher \\(pid ${dispatcherPid}\\)`));
  assert.match(await readFile(join(lanesDir, "pool.status"), "utf8"), new RegExp(`dispatcher ${dispatcherPid} stopped by its service; its running lanes run on`));
});

test("3.33 · the dispatcher's service holds the dispatcher once a run of its own ended on exit 75, and not for one that ended so before it started", async (t) => {
  const lanesDir = await folder(t);
  const status = join(lanesDir, "pool.status");
  await writeFile(status, "2026-11-03T00:00:00Z dispatcher started\n2026-11-03T00:01:00Z pool stopped: engine failing at once on increment_a\n");
  const script = join(lanesDir, "launch.mjs");
  // Each run says it started; the second ends on 75, as the dispatcher does with an engine failing at once.
  await writeFile(script, `import { appendFileSync, readFileSync } from "node:fs";
const status = process.argv[3] + "/pool.status";
const runs = readFileSync(status, "utf8").split("dispatcher started").length - 1;
appendFileSync(status, "2026-11-03T00:02:00Z dispatcher started\\n" + (runs >= 2 ? "2026-11-03T00:03:00Z pool stopped: engine failing at once on increment_b\\n" : ""));
`);
  const stopping = new AbortController();
  const lines = [];
  const service = poolService("dispatcher", { lanesDir, checkout: lanesDir, command: [process.execPath, [script, "pool", lanesDir]], pollMs: 20, argsOf: async () => "" });
  const running = service.start({ stopping: stopping.signal, log: (line) => lines.push(line) });
  await waitUntil(() => lines.some((line) => line.startsWith("the dispatcher is left stopped")), 10_000, "the dispatcher held on its exit 75");
  stopping.abort();
  await running;
  assert.equal(lines.filter((line) => line.startsWith("started the dispatcher")).length, 2, "the exit 75 from before its start held nothing; its own held the next start");
  assert.match(lines.at(-1), /left stopped: its last run ended on exit 75 \(pool stopped: engine failing at once on increment_b\); start it again with: storytree services restart agent-pool\/dispatcher/);
});
