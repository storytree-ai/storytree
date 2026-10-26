/** Capability 7 · Experiment dispatcher: a fake box (engines, cap, the real pool's ready work, each arm's) and fake lanes. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { forgetTrunk, machineOf, readExperiment, registerTrunk, requireApproval, trunksOn } from "@storytree/project-and-caller";

import type { Experiment } from "../record/record.js";
import type { Curves, Point } from "../points/points.js";
import { ExperimentRefusal } from "../record/record.js";
import { withLibrary } from "../testing/pg.js";
import { approveCheckouts, armLaneCommand, armRuns, laneBrief, laneFiles, lookCommand, PLAN_RULES, readyArgs, runExperiment, stateFile, statusFile, type ArmRun, type Lane, type Look, type RunState } from "./dispatcher.js";

const RULES = { flatMerges: 2, wallClockMs: 3600_000, wallClock: "1 hour" };
const ARMS: ArmRun[] = [
  { arm: "map-reads-on", project: "x-twin-map-reads-on", home: "/h/on", checkout: "/h/on/repo" },
  { arm: "map-reads-off", project: "x-twin-map-reads-off", home: "/h/off", checkout: "/h/off/repo" },
];

/** A box whose real pool and arms are scripted per look; the dispatcher runs until `rounds` looks have passed. */
function fakeBox({ rounds, real, arms, looks = {}, lane = async () => {}, rules = RULES, plans = {}, planRounds = 0, points = async () => ({}), record = async () => [], state = { arms: {} } as RunState, launchCode = 0, start = "2026-10-17T00:00:00Z" }: {
  rounds: number;
  real: (round: number) => Look;
  arms: Record<string, (round: number) => string[]>;
  /** An arm's look read for real, in place of its scripted `arms` and `plans`. */
  looks?: Record<string, (arm: ArmRun) => Promise<Look>>;
  /** What a lane does to its arm's library before it ends. */
  lane?: (arm: ArmRun, one: Lane) => Promise<void>;
  rules?: typeof RULES;
  plans?: Record<string, (round: number) => { id: string; title: string; state: string }[]>;
  planRounds?: number;
  points?: (round: number) => Promise<Curves>;
  record?: (round: number) => Promise<readonly string[]>;
  state?: RunState;
  launchCode?: number;
  start?: string;
}) {
  let round = 0;
  const lines: string[] = [], launched: string[] = [], saved: RunState[] = [];
  const lanes: Promise<number>[] = [];
  // A planning lane runs for `planRounds` looks (or until the run stops), so a look can find it still running.
  const planning: { until: number; end: () => void }[] = [];
  const endPlans = (all: boolean) => { for (const lane of planning.filter((one) => all || round >= one.until)) { lane.end(); planning.splice(planning.indexOf(lane), 1); } };
  let clock = Date.parse(start);
  return {
    lines, launched, saved,
    run: () => runExperiment({
      arms: ARMS, rules, pollMs: 60_000, backoffMs: 30 * 60_000,
      look: async (arm) => (arm === undefined
        ? real(round)
        : looks[arm.arm] ? looks[arm.arm]!(arm)
        : { running: 0, cap: 0, lanesDir: "/l", ready: (arms[arm.arm]?.(round) ?? []).map((id) => ({ id, title: id })), plans: plans[arm.arm]?.(round) ?? [] }),
      points: () => points(round),
      record: () => record(round),
      launch: (arm, one, { engineUp }) => {
        launched.push(`${arm.arm}:${one.plan ? "plan:" : ""}${one.id}`);
        engineUp();
        if (one.plan && planRounds > 0) return new Promise((done) => planning.push({ until: round + planRounds, end: () => done(launchCode) }));
        const ended = lane(arm, one).then(() => launchCode);
        lanes.push(ended);
        return ended;
      },
      state: { load: async () => structuredClone(state), save: async (next) => { saved.push(structuredClone(next)); } },
      stopped: async () => { const done = round >= rounds; if (done) endPlans(true); return done; },
      sleep: async (ms) => { round += 1; clock += ms; endPlans(false); await Promise.all(lanes); await new Promise((go) => setImmediate(go)); },
      now: () => clock,
      say: (line) => lines.push(line),
    }),
  };
}

const idle = (running = 0, cap = 4): Look => ({ running, cap, lanesDir: "/l", ready: [] });

test("7.1 · a run carries each arm's denies from the frozen record into the arm's home, none when it names none; an arm whose home is not its own, or has no checkout, refuses the run before any home is written", () => {
  const record = (arms: Experiment["arms"]) => ({ arms } as Experiment);
  const root = mkdtempSync(path.join(tmpdir(), "arm-runs-"));
  const make = (arm: string, named = arm) => {
    const home = path.join(root, `x-twin-${arm}`);
    mkdirSync(path.join(home, "repo"), { recursive: true });
    writeFileSync(path.join(home, "settings.json"), JSON.stringify({ experiment: { name: "twin", arm: named } }));
    return home;
  };
  try {
    const on = make("map-reads-on"), off = make("reviewer-off");
    const arms = record([
      { name: "map-reads-on", description: "on" },
      { name: "reviewer-off", description: "off", denies: { tools: ["quality_brief"], commands: ["storytree quality"] } },
    ]);
    assert.deepEqual(armRuns(arms, "twin", root), [
      { arm: "map-reads-on", project: "x-twin-map-reads-on", home: on, checkout: path.join(on, "repo") },
      { arm: "reviewer-off", project: "x-twin-reviewer-off", home: off, checkout: path.join(off, "repo") },
    ]);
    assert.deepEqual(readExperiment(on), { name: "twin", arm: "map-reads-on", denies: { tools: [], commands: [] } });
    assert.deepEqual(readExperiment(off), { name: "twin", arm: "reviewer-off", denies: { tools: ["quality_brief"], commands: ["storytree quality"] } });

    const fresh = make("map-reads-off");
    make("misnamed", "map-reads-on");
    const before = readFileSync(path.join(fresh, "settings.json"), "utf8");
    assert.throws(() => armRuns(record([{ name: "map-reads-off", description: "off", denies: { tools: ["focus"], commands: [] } }, { name: "misnamed", description: "x" }]), "twin", root),
      (error: Error) => error instanceof ExperimentRefusal && /not the home of arm "misnamed"/.test(error.message));
    assert.equal(readFileSync(path.join(fresh, "settings.json"), "utf8"), before, "no home is written when another arm refuses the run");
    rmSync(path.join(fresh, "repo"), { recursive: true });
    assert.throws(() => armRuns(record([{ name: "map-reads-off", description: "off" }]), "twin", root),
      (error: Error) => error instanceof ExperimentRefusal && /no checkout/.test(error.message));
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test("7.5 · each arm lane is the agent runner's exported runner entry, run as its own process in the arm's checkout with the arm's home as its storytree home", () => {
  const command = armLaneCommand({ arm: ARMS[1]!, brief: "/l/b.md", log: "/l/x.log", err: "/l/x.err", addDirs: ["/l"], env: { PATH: "/bin", STORYTREE_HOME: "/real" } });
  assert.deepEqual(command, {
    command: process.execPath,
    args: [fileURLToPath(import.meta.resolve("@storytree/agent-pool/runner")), "run", "/l/b.md", "/l/x.log", "/l/x.err", "/l"],
    cwd: "/h/off/repo",
    env: { PATH: "/bin", STORYTREE_HOME: "/h/off" },
  });
  const lanes = mkdtempSync(path.join(tmpdir(), "experiment-run-"));
  try {
    assert.equal(stateFile(lanes, "twin"), path.join(lanes, "experiment-twin.json"));
  } finally { rmSync(lanes, { recursive: true, force: true }); }
});

test("7.16 · a look runs the agent runner's exported launch entry as its own process, as the arm's home when it is an arm's", () => {
  const launch = fileURLToPath(import.meta.resolve("@storytree/agent-pool/launch"));
  const real = lookCommand("storytree", undefined, { PATH: "/bin" });
  assert.equal(real.args[2], launch);
  assert.deepEqual(real.args.slice(3), ["ready", "storytree"]);
  assert.deepEqual(real.env, { PATH: "/bin" });
  const arm = lookCommand("x-twin-map-reads-on", "/h/on", { PATH: "/bin", STORYTREE_HOME: "/real" });
  assert.deepEqual(arm.args.slice(2), [launch, "ready", "x-twin-map-reads-on", "--drained"]);
  assert.deepEqual(arm.env, { PATH: "/bin", STORYTREE_HOME: "/h/on" });
});

test("7.7 · each look records the arms' new merges as points before their stop rules read the curves, saying what it recorded; a record that fails is said and the look goes on", async () => {
  const recorded: Record<string, Point[]> = {};
  const box = fakeBox({
    rounds: 3,
    real: () => idle(0, 4),
    record: async (round) => {
      if (round === 0) throw new Error("gh: HTTP 502\nmore");
      if (round === 1) return [];
      recorded["map-reads-on"] = [{ merge: 1, pr: 4, mergedAt: "", commit: "", files: 1, bytes: 1, workflowIntact: true, passed: 372, total: 372 }];
      return ["map-reads-on: recorded merge 1 (#4, 372/372)"];
    },
    points: async () => recorded,
    arms: { "map-reads-on": (round) => [`on${round}`], "map-reads-off": () => [] },
  });
  await box.run();
  assert.ok(box.lines.some((line) => /could not record the arms' points \(gh: HTTP 502\)/.test(line)), "the failure is said in one line");
  assert.deepEqual(box.launched, ["map-reads-on:on0", "map-reads-on:on1"], "a failed record does not stop the look; a point recorded at a look is read by that look's stop rules");
  assert.ok(box.lines.some((line) => /map-reads-on: recorded merge 1 \(#4, 372\/372\)/.test(line)));
  assert.match(box.saved.at(-1)?.arms["map-reads-on"]?.stopped ?? "", /passes all 372 tests/);
});

test("7.8 · an arm with nothing ready is given one planning lane for its first arc whose state it has not planned in, never two at once, kept across restarts and counted among its lanes", async () => {
  const box = fakeBox({
    rounds: 6, planRounds: 2,
    state: { arms: { "map-reads-off": { launches: 0, planned: { arc_off: "t1" } } } },
    real: () => idle(0, 4),
    arms: { "map-reads-on": () => [], "map-reads-off": (round) => (round === 0 ? ["off1"] : []) },
    plans: {
      "map-reads-on": (round) => [{ id: "arc_on", title: "On's arc", state: round < 4 ? "s1" : "s2" }, ...(round < 2 ? [{ id: "arc_on2", title: "Another", state: "x" }] : [])],
      "map-reads-off": () => [{ id: "arc_off", title: "Off's arc", state: "t1" }],
    },
  });
  assert.equal(await box.run(), 0);
  assert.deepEqual(box.launched, ["map-reads-on:plan:arc_on", "map-reads-off:off1", "map-reads-on:plan:arc_on"],
    "round 0: one planning lane for on, not two, while off builds; rounds 1-3: on's lane runs, then its arc is unchanged, and off's arc was planned in its state before the restart; round 4: on's arc changed");
  assert.ok(box.lines.some((line) => /plan arc_on \(On's arc\) in arm map-reads-on: nothing ready/.test(line)));
  assert.deepEqual(box.saved.at(-1)?.arms, {
    "map-reads-on": { launches: 2, firstLane: "2026-10-17T00:00:00.000Z", planned: { arc_on: "s2" }, idlePlans: 1, checking: "arc_on" },
    "map-reads-off": { launches: 1, firstLane: "2026-10-17T00:00:00.000Z", planned: { arc_off: "t1" } },
  });
});

test("7.9 · a build lane's brief names its increment and ends with the lane rules; a planning lane's names its arc and ends with the planning rules beside the dispatcher; each names the arm's home, library and checkout", () => {
  const planRules = readFileSync(PLAN_RULES, "utf8");
  const build = laneBrief({ arm: ARMS[0]!, name: "twin", one: { id: "increment_a", title: "A" }, rules: "BUILD RULES", planRules });
  const plan = laneBrief({ arm: ARMS[0]!, name: "twin", one: { id: "arc_a", title: "The task", plan: true }, rules: "BUILD RULES", planRules });
  assert.match(build, /^# Experiment lane: increment_a\n\nYour increment: increment_a\. /);
  assert.ok(build.endsWith("BUILD RULES"));
  assert.match(plan, /^# Experiment planning lane: arc_a\n\nYour arc: arc_a \(The task\)\. /);
  assert.ok(plan.endsWith(planRules) && !plan.includes("BUILD RULES"));
  for (const brief of [build, plan]) assert.ok(brief.includes("/h/on") && brief.includes("x-twin-map-reads-on") && brief.includes("/h/on/repo"));
});

test("7.10 · a run approves each arm's checkout as its trunk, as the machine its home names, through the admin's connection: one with no trunk is recorded approved, one recorded unapproved is approved, one already approved is left alone, and a project whose trunk is elsewhere refuses the run", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "arm-trunks-"));
  const tag = randomBytes(3).toString("hex");
  const arm = (name: string): ArmRun => {
    const home = path.join(root, name);
    mkdirSync(path.join(home, "repo"), { recursive: true });
    return { arm: name, project: `x-${tag}-${name}`, home, checkout: path.join(home, "repo") };
  };
  const none = arm("none"), unapproved = arm("unapproved"), joined = arm("joined"), elsewhere = arm("elsewhere");
  const trunkOf = (server: Parameters<typeof trunksOn>[0], one: ArmRun) => trunksOn(server, machineOf(one.home).id).then((all) => all.find((trunk) => trunk.project === one.project));
  try {
    await withLibrary(async (_library, server) => {
      try {
        const record = (one: ArmRun, by?: string) => { const machine = machineOf(one.home); return registerTrunk(server, { project: one.project, machine: machine.id, machineName: machine.name, folder: realpathSync.native(one.checkout) }, by); };
        await record(unapproved);
        await record(joined, "join");
        assert.deepEqual(await approveCheckouts(server, [none, unapproved, joined]), [
          `approved ${realpathSync.native(none.checkout)} as arm none's checkout (${none.project})`,
          `approved ${realpathSync.native(unapproved.checkout)} as arm unapproved's checkout (${unapproved.project})`,
        ]);
        for (const one of [none, unapproved, joined]) await requireApproval(server, one.project, one.checkout, one.home);
        assert.equal((await trunkOf(server, none))?.approvedBy, "experiment run");
        assert.equal((await trunkOf(server, joined))?.approvedBy, "join", "an approved checkout is left as it was");
        assert.deepEqual(await approveCheckouts(server, [none, unapproved, joined]), [], "approving again changes nothing");

        const machine = machineOf(elsewhere.home);
        await registerTrunk(server, { project: elsewhere.project, machine: machine.id, machineName: machine.name, folder: path.join(root, "other") }, "join");
        await assert.rejects(approveCheckouts(server, [elsewhere]), (error: Error) => error instanceof ExperimentRefusal && /already has its trunk at/.test(error.message));
      } finally {
        for (const one of [none, unapproved, joined, elsewhere]) await forgetTrunk(server, { project: one.project }, one.home);
      }
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("7.11 · a planning lane that ends with its arm's arc unchanged and nothing ready leaves that arc offered again after the back-off, said once; one after which work is ready leaves it planned", async () => {
  const box = fakeBox({
    rounds: 34, planRounds: 2,
    real: () => idle(0, 4),
    arms: { "map-reads-on": () => [], "map-reads-off": (round) => (round === 2 ? ["off1"] : []) },
    plans: {
      "map-reads-on": () => [{ id: "arc_on", title: "On's arc", state: "s1" }],
      "map-reads-off": () => [{ id: "arc_off", title: "Off's arc", state: "t1" }],
    },
  });
  assert.equal(await box.run(), 0);
  assert.deepEqual(box.launched, ["map-reads-on:plan:arc_on", "map-reads-off:plan:arc_off", "map-reads-off:off1", "map-reads-on:plan:arc_on"],
    "both lanes end at round 2; on's arc is unchanged with nothing ready, so it is offered again at round 32, 30 minutes after its lane ended; off's lane left work ready, so its arc stays planned");
  assert.equal(box.lines.filter((line) => /plan arc_on in arm map-reads-on changed nothing: offered again after the back-off/.test(line)).length, 1);
  assert.ok(!box.lines.some((line) => /arc_off in arm map-reads-off changed nothing/.test(line)));
  assert.deepEqual(box.saved.at(-1)?.arms["map-reads-off"]?.planned, { arc_off: "t1" });
});

test("7.12 · a run restarted while an unchanged arc waits out its back-off keeps the back-off: the arc is offered again only once it has passed", async () => {
  const plans = { "map-reads-on": () => [{ id: "arc_on", title: "On's arc", state: "s1" }] };
  const first = fakeBox({ rounds: 4, planRounds: 2, real: () => idle(0, 4), arms: {}, plans });
  await first.run();
  assert.deepEqual(first.launched, ["map-reads-on:plan:arc_on"]);
  const second = fakeBox({ rounds: 30, real: () => idle(0, 4), arms: {}, plans, state: first.saved.at(-1)!, start: "2026-10-17T00:04:00Z" });
  await second.run();
  assert.deepEqual(second.launched, ["map-reads-on:plan:arc_on"], "the lane ended at 00:02, so the restarted run, from 00:04, offers the arc again at 00:32, its 28th look, not at once");
  assert.ok(second.lines.some((line) => line.startsWith("2026-10-17T00:32:00Z plan arc_on")), second.lines.join("\n"));
});

test("7.13 · an arc that leaves an arm's plannable list while its work is open is offered again when it drains, as the real ready reads it, even in the state it was first planned in; one still listed keeps its plan", async () => {
  // The agent pool is a devDependency here, imported by a string so the .mjs needs no types; ready runs in process, since counting engines runs `ps`.
  const launch: string = "@storytree/agent-pool/launch", feed: string = "@storytree/agent-pool/feed";
  const [{ main }, { readSurvey }] = await Promise.all([import(launch), import(feed)]);
  const lanesDir = mkdtempSync(path.join(tmpdir(), "experiment-ready-"));
  try {
    await withLibrary(async (library) => {
      const arc = await library.createArc({ title: "On's arc", intent: "Build the task", endState: "The task works" });
      const ready = async (arm: ArmRun): Promise<Look> => {
        const out: string[] = [];
        // Read from an hour on, as an arm's look comes long after the arc was seeded: the pool leaves an arc made in the last half hour to its author.
        const box = { survey: () => readSurvey({ library, claims: async () => [] }), count: async () => 0, maxLanes: async () => 4, lanesDir, now: () => Date.now() + 3600_000, out: (line: string) => out.push(line) };
        assert.equal(await main(readyArgs(arm.project, { arm: true }), box), 0);
        return JSON.parse(out.join("\n")) as Look;
      };
      const box = fakeBox({
        rounds: 3,
        real: () => idle(0, 4),
        arms: { "map-reads-off": () => [] },
        looks: { "map-reads-on": ready },
        plans: { "map-reads-off": () => [{ id: "arc_off", title: "Off's arc", state: "t1" }] },
        state: { arms: { "map-reads-off": { launches: 0, planned: { arc_off: "t1" } } } },
        lane: async (arm, one) => {
          if (arm.arm !== "map-reads-on") return;
          if (one.plan) await library.addIncrement({ arc: one.id, title: "The task", objective: "It works", body: "Build it." });
          else {
            await library.advanceIncrement(one.id, "active");
            await library.closeIncrement(one.id, { disposition: "landed", pr: "1" });
          }
        },
      });
      assert.equal(await box.run(), 0);
      const built = box.launched[1]?.replace("map-reads-on:", "");
      assert.deepEqual(box.launched, [`map-reads-on:plan:${arc.id}`, `map-reads-on:${built}`, `map-reads-on:plan:${arc.id}`],
        "round 0: on's arc has no work, so it is planned at [0,[]]; round 1: the increment its lane parked is ready and the arc is not listed; round 2: that increment closed, the arc reads closed and only the arm's drained listing offers it, at [0,[]] again, so it is planned again; off's arc stays listed in the state it was planned in");
      assert.match(built ?? "", /^increment_/);
      assert.deepEqual(box.saved.at(-1)?.arms["map-reads-off"]?.planned, { arc_off: "t1" });
    });
  } finally { rmSync(lanesDir, { recursive: true, force: true }); }
});

test("7.14 · an arm whose planning lane changes nothing on three consecutive tries, the back-off between them, is stopped as declared done, said once and kept; the other arm runs on", async () => {
  const box = fakeBox({
    rounds: 70, planRounds: 1, rules: { ...RULES, wallClockMs: 6 * 3600_000, wallClock: "6 hours" },
    real: () => idle(0, 4),
    arms: { "map-reads-on": () => [], "map-reads-off": (round) => (round === 1 ? ["off1"] : []) },
    plans: {
      "map-reads-on": () => [{ id: "arc_on", title: "On's arc", state: "[0,[]]" }],
      "map-reads-off": () => [{ id: "arc_off", title: "Off's arc", state: "t1" }],
    },
  });
  assert.equal(await box.run(), 0);
  assert.deepEqual(box.launched.filter((one) => one.startsWith("map-reads-on")), ["map-reads-on:plan:arc_on", "map-reads-on:plan:arc_on", "map-reads-on:plan:arc_on"],
    "on's arc is planned at rounds 0, 31 and 62; the third lane, like the two before it, changes nothing, so no fourth is offered");
  const stops = box.lines.filter((line) => line.includes("stopped arm map-reads-on: declared done"));
  assert.equal(stops.length, 1, box.lines.join("\n"));
  assert.match(stops[0]!, /its planning lane changed nothing on 3 consecutive tries/);
  assert.match(box.saved.at(-1)?.arms["map-reads-on"]?.stopped ?? "", /^declared done/);
  assert.equal(box.saved.at(-1)?.arms["map-reads-off"]?.stopped, undefined);
});

test("7.15 · an arm lane's folders list none of the run's state, status or output, nor another arm's review returns: each lane writes in its arm's home, and the run's lanes folder is never given to it", () => {
  const root = mkdtempSync(path.join(tmpdir(), "experiment-blind-"));
  try {
    const lanesDir = path.join(root, "storytree-lanes");
    const [on, off] = ARMS.map((arm) => ({ ...arm, home: path.join(root, arm.arm), checkout: path.join(root, arm.arm, "repo") }));
    for (const dir of [lanesDir, on!.checkout, off!.checkout]) mkdirSync(dir, { recursive: true });
    writeFileSync(stateFile(lanesDir, "twin"), "{}\n");
    writeFileSync(statusFile(lanesDir, "twin"), "map-reads-on: recorded merge 1 (#4, 372/372)\n");
    writeFileSync(path.join(lanesDir, "experiment-twin.out"), "372/372\n");
    for (const [arm, one] of [[on!, "increment_on"], [off!, "increment_off"]] as const) {
      const files = laneFiles({ arm, name: "twin", one: { id: one, title: one }, at: "20261020T000000" });
      mkdirSync(files.folder, { recursive: true });
      for (const file of [files.brief, files.log, files.err]) writeFileSync(file, "");
      writeFileSync(path.join(files.folder, `review-${one}-1.json`), "{}\n");
    }
    const lane = laneFiles({ arm: on!, name: "twin", one: { id: "increment_on", title: "On" }, at: "20261020T000000" });
    const command = armLaneCommand({ arm: on!, ...lane, env: {} });
    const listed = [command.cwd, ...command.args.slice(5)].flatMap((dir) => readdirSync(dir, { recursive: true }).map(String));
    assert.ok(listed.includes(path.basename(lane.brief)), "the lane lists its own brief");
    for (const hidden of ["experiment-twin.json", "experiment-twin.status", "experiment-twin.out", "review-increment_off-1.json"]) {
      assert.ok(!listed.some((name) => name.endsWith(hidden)), `${hidden} is not in an arm lane's listing`);
    }
    assert.ok(!command.args.includes(lanesDir), "the run's lanes folder is not given to the lane");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
