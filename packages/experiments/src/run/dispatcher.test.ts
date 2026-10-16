/** Capability 7 · Experiment dispatcher: a fake box (engines, cap, the real pool's ready work, each arm's) and fake lanes. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { Experiment } from "../record/record.js";
import type { Curves } from "../points/points.js";
import { ExperimentRefusal } from "../record/record.js";
import { armLaneCommand, checkArms, runExperiment, stateFile, type ArmRun, type Look, type RunState } from "./dispatcher.js";

const RULES = { flatMerges: 2, wallClockMs: 3600_000, wallClock: "1 hour" };
const ARMS: ArmRun[] = [
  { arm: "map-reads-on", project: "x-twin-map-reads-on", home: "/h/on", checkout: "/h/on/repo" },
  { arm: "map-reads-off", project: "x-twin-map-reads-off", home: "/h/off", checkout: "/h/off/repo" },
];

/** A box whose real pool and arms are scripted per look; the dispatcher runs until `rounds` looks have passed. */
function fakeBox({ rounds, real, arms, points = async () => ({}), state = { arms: {} } as RunState, launchCode = 0 }: {
  rounds: number;
  real: (round: number) => Look;
  arms: Record<string, (round: number) => string[]>;
  points?: (round: number) => Promise<Curves>;
  state?: RunState;
  launchCode?: number;
}) {
  let round = 0;
  const lines: string[] = [], launched: string[] = [], saved: RunState[] = [];
  const lanes: Promise<number>[] = [];
  let clock = Date.parse("2026-10-17T00:00:00Z");
  return {
    lines, launched, saved,
    run: () => runExperiment({
      arms: ARMS, rules: RULES, pollMs: 60_000, backoffMs: 30 * 60_000,
      look: async (arm) => (arm === undefined
        ? real(round)
        : { running: 0, cap: 0, lanesDir: "/l", ready: (arms[arm.arm]?.(round) ?? []).map((id) => ({ id, title: id })) }),
      points: () => points(round),
      launch: (arm, one, { engineUp }) => {
        launched.push(`${arm.arm}:${one.id}`);
        engineUp();
        const lane = Promise.resolve(launchCode);
        lanes.push(lane);
        return lane;
      },
      state: { load: async () => structuredClone(state), save: async (next) => { saved.push(structuredClone(next)); } },
      stopped: async () => round >= rounds,
      sleep: async (ms) => { round += 1; clock += ms; await Promise.all(lanes); await new Promise((go) => setImmediate(go)); },
      now: () => clock,
      say: (line) => lines.push(line),
    }),
  };
}

const idle = (running = 0, cap = 4): Look => ({ running, cap, lanesDir: "/l", ready: [] });

test("7.1 · a run reads the frozen record's arms: each must be one the arm switch holds, denying the same verbs, or the run is refused", () => {
  const record = (arms: Experiment["arms"]) => ({ arms } as Experiment);
  assert.deepEqual(checkArms(record([
    { name: "map-reads-on", description: "on" },
    { name: "map-reads-off", description: "off", denies: { tools: ["focus"], commands: ["storytree map"] } },
  ])), ["map-reads-on", "map-reads-off"]);
  assert.throws(() => checkArms(record([{ name: "map-reads-on", description: "on" }, { name: "map-reads-off", description: "off" }])),
    (error: Error) => error instanceof ExperimentRefusal && /map-reads-off/.test(error.message));
  assert.throws(() => checkArms(record([{ name: "map-reads-on", description: "on" }, { name: "reviewer-off", description: "off" }])),
    (error: Error) => error instanceof ExperimentRefusal && /reviewer-off/.test(error.message));
});

test("7.2 · it takes a slot only while the real pool has no ranked work waiting and leaves one slot free for real work; ranked work pauses it, never stops it", async () => {
  const ranked: Look = { running: 0, cap: 4, lanesDir: "/l", ready: [{ id: "increment_real", title: "real", priority: 1 }] };
  const box = fakeBox({
    rounds: 4,
    real: (round) => (round === 0 ? ranked : round === 1 ? { ...idle(2), ready: [{ id: "increment_unranked", title: "u" }] } : idle(3)),
    arms: { "map-reads-on": () => ["on1", "on2"], "map-reads-off": () => ["off1", "off2"] },
  });
  assert.equal(await box.run(), 0);
  assert.deepEqual(box.launched, ["map-reads-on:on1"], "round 0 paused; round 1: 4 - 2 running - 1 kept = 1 slot (unranked work does not pause it); then 4 - 3 - 1 = none");
  assert.ok(box.lines.some((line) => /paused: the real pool has ranked work waiting \(increment_real\)/.test(line)));
  assert.ok(box.lines.some((line) => /resumed/.test(line)));
  assert.ok(!box.saved.some((state) => Object.values(state.arms).some((arm) => arm.stopped)), "a pause stops no arm");
});

test("7.3 · it alternates the arms, the one with fewer lanes first, across restarts; an arm with nothing ready yields its turn; no increment starts twice or again within the back-off", async () => {
  const box = fakeBox({
    rounds: 3,
    state: { arms: { "map-reads-on": { launches: 3, firstLane: "2026-10-17T00:00:00Z" }, "map-reads-off": { launches: 2, firstLane: "2026-10-17T00:00:00Z" } } },
    real: () => idle(0, 4),
    arms: { "map-reads-on": () => ["on1", "on2"], "map-reads-off": (round) => (round === 0 ? ["off1"] : ["off1", "off2"]) },
  });
  await box.run();
  assert.deepEqual(box.launched.slice(0, 3), ["map-reads-off:off1", "map-reads-on:on1", "map-reads-on:on2"], "off has fewer lanes; then on, and off has nothing else ready");
  assert.deepEqual(box.launched.slice(3), ["map-reads-off:off2"], "round 1: off1, on1 and on2 ended inside the back-off; off2 is new");
  assert.deepEqual(box.saved.at(-1)?.arms, {
    "map-reads-on": { launches: 5, firstLane: "2026-10-17T00:00:00Z" },
    "map-reads-off": { launches: 4, firstLane: "2026-10-17T00:00:00Z" },
  });
});

test("7.4 · an arm whose stop rule holds is stopped, said and kept stopped while the other runs on; the run ends when every arm has stopped", async () => {
  const flat = (merges: number) => Array.from({ length: merges }, (_, at) => ({ merge: at + 1, pr: at + 1, mergedAt: "", commit: "", files: 1, bytes: 1, workflowIntact: true, passed: 5, total: 370 }));
  const box = fakeBox({
    rounds: 10,
    real: () => idle(0, 4),
    points: async (round) => ({ "map-reads-on": flat(3), "map-reads-off": flat(round >= 1 ? 3 : 1) }),
    arms: { "map-reads-on": () => ["on1"], "map-reads-off": (round) => [`off${round}`] },
  });
  assert.equal(await box.run(), 0);
  assert.deepEqual(box.launched, ["map-reads-off:off0"]);
  assert.match(box.saved.at(-1)?.arms["map-reads-on"]?.stopped ?? "", /not risen for 2 merges/);
  assert.match(box.saved.at(-1)?.arms["map-reads-off"]?.stopped ?? "", /not risen for 2 merges/);
  assert.ok(box.lines.some((line) => /stopped arm map-reads-on: its verifier share has not risen/.test(line)));
  assert.match(box.lines.at(-1) ?? "", /every arm has stopped/);
});

test("7.5 · each arm lane is the agent pool's lane runner, run as its own process in the arm's checkout with the arm's home as its storytree home", () => {
  const command = armLaneCommand({ arm: ARMS[1]!, repo: "/code/storytree03", brief: "/l/b.md", log: "/l/x.log", err: "/l/x.err", addDirs: ["/l"], env: { PATH: "/bin", STORYTREE_HOME: "/real" } });
  assert.deepEqual(command, {
    command: process.execPath,
    args: [path.join("/code/storytree03", "packages/agent-pool/src/runner.mjs"), "run", "/l/b.md", "/l/x.log", "/l/x.err", "/l"],
    cwd: "/h/off/repo",
    env: { PATH: "/bin", STORYTREE_HOME: "/h/off" },
  });
  const lanes = mkdtempSync(path.join(tmpdir(), "experiment-run-"));
  try {
    assert.equal(stateFile(lanes, "twin"), path.join(lanes, "experiment-twin.json"));
  } finally { rmSync(lanes, { recursive: true, force: true }); }
});
