import assert from "node:assert/strict";
import { test } from "node:test";

import { runPool } from "./launch.mjs";
import { readBoxPace, saturationOf } from "./pace.mjs";

const now = Date.parse("2026-10-23T12:00:00Z");
const GB = 1024 * 1024; // /proc/meminfo counts kB

test("3.20 · only a saturated box holds dispatch back: CPU run queue, memory or a GPU really maxed; busy is not saturated, and an unread part holds nothing back", () => {
  assert.equal(saturationOf({}), undefined, "nothing read: dispatch as usual");
  const busy = { cores: 12, load5: 14, memTotal: 32 * GB, memAvailable: 3 * GB, gpus: [{ util: 90, memUsed: 5, memTotal: 6 }] };
  assert.equal(saturationOf(busy), undefined, "busy, not maxed: a load above the cores, 9% memory free and a 90% GPU hold nothing back");

  const cpu = saturationOf({ ...busy, load5: 18 });
  assert.deepEqual([cpu.hold, cpu.windows], ["pause", ["cpu"]]);
  assert.match(cpu.reason, /box saturated: CPU load 18\.0 on 12 cores/);
  assert.deepEqual(saturationOf({ ...busy, memAvailable: 1 * GB }).windows, ["memory"], "5% or less of memory free");
  assert.deepEqual(saturationOf({ ...busy, gpus: [{ util: 40, memUsed: 1, memTotal: 6 }, { util: 99, memUsed: 1, memTotal: 6 }] }).windows, ["gpu1"]);
  assert.deepEqual(saturationOf({ ...busy, gpus: [{ util: 10, memUsed: 5.8, memTotal: 6 }] }).windows, ["gpu0"], "a GPU's memory full");
});

test("3.20 · the box reading comes from /proc and nvidia-smi; Claude's and Codex's usage are never read, and a missing source is left unread", async () => {
  const files = {
    "/proc/loadavg": "20.10 19.50 12.00 3/900 4242\n",
    "/proc/meminfo": "MemTotal:       32808824 kB\nMemFree:          100000 kB\nMemAvailable:   28402864 kB\n",
  };
  const readText = async (path) => { if (!(path in files)) throw new Error(`ENOENT ${path}`); return files[path]; };
  const held = await readBoxPace({ cores: 12, readText, nvidia: async () => "97, 100, 6144\n" });
  assert.deepEqual(held.windows, ["cpu", "gpu0"], "load 19.5 on 12 cores, and the GPU at 97%");

  const bare = await readBoxPace({ cores: 12, readText: async () => { throw new Error("no /proc"); }, nvidia: async () => { throw new Error("Failed to initialize NVML"); } });
  assert.equal(bare, undefined, "no /proc and no working nvidia-smi (as on the Mint box's driver mismatch): nothing held back");
});

test("3.20 · the dispatcher holds back while the box is saturated, saying why in its status once per change, and dispatches to the cap once it clears; usage near a limit never slows it; a failed reading dispatches as usual", async () => {
  const lines = [], started = [], ends = [];
  let engines = 0, looks = 0, stop = false;
  const paces = [
    { hold: "pause", windows: ["cpu"], reason: "box saturated: CPU load 19.5 on 12 cores" },
    { hold: "pause", windows: ["cpu"], reason: "box saturated: CPU load 19.9 on 12 cores" },
    undefined,
  ];
  await runPool({
    survey: async () => ({ increments: ["a", "b", "c", "d", "e"].map((id, at) => ({ id, arc: `arc_${id}`, arcState: "active", title: id, body: "", status: "proposal", parked: `2026-10-0${at + 1}T00:00:00Z` })), holds: { waits: {}, heldOn: {} }, claims: [] }),
    pace: async () => paces.shift(),
    maxLanes: async () => 4, count: async () => engines, stopFile: "/lanes/pool-stop", exists: async () => stop, now: () => now, say: (line) => lines.push(line),
    launch: (one, { engineUp }) => { started.push(one.id); engines += 1; engineUp(); return new Promise((done) => ends.push(done)); },
    sleep: async () => {
      looks += 1;
      await new Promise((go) => setImmediate(go));
      if (looks === 2) assert.deepEqual(started, [], "saturated: nothing starts");
      if (looks === 3) { assert.deepEqual(started, ["a", "b", "c", "d"], "clear: the whole cap at once"); stop = true; engines = 0; for (const end of ends) end(0); }
    },
  });
  const said = lines.filter((line) => /holding back|slowing|box clear|rate limit/.test(line));
  assert.equal(said.length, 2, "said once per change, not once per look");
  assert.match(said[0], /holding back dispatch: box saturated: CPU load 19\.5 on 12 cores/);
  assert.match(said[1], /box clear: dispatching up to the cap/);

  const failing = [];
  let ran = 0;
  await runPool({
    survey: async () => ({ increments: [{ id: "a", arc: "arc_a", arcState: "active", title: "a", body: "", status: "proposal", parked: "2026-10-01T00:00:00Z" }], holds: { waits: {}, heldOn: {} }, claims: [] }),
    pace: async () => { throw new Error("proc unreadable"); },
    maxLanes: async () => 1, count: async () => ran, stopFile: "/lanes/pool-stop", exists: async () => ran > 0, now: () => now, say: (line) => failing.push(line),
    launch: async (one, { engineUp }) => { ran += 1; engineUp(); return 0; }, sleep: async () => {},
  });
  assert.equal(ran, 1, "an unread box dispatches as usual");
  assert.ok(failing.some((line) => /box readings unread \(proc unreadable\)/.test(line)));
});
