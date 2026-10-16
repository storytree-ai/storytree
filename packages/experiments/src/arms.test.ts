/** Capability 1 · Arm switch: every home here is a throwaway folder, its settings written by the test. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { carryDenies, verdictOf, type Denies } from "./index.js";

function inArm(home: string, arm: string, denies?: Denies): void {
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ experiment: { name: "twin-build", arm, ...(denies === undefined ? {} : { denies }) } }));
}

test("1.1 · a verb's verdict is read from the caller's storytree home: none named allows every verb; an arm denies each tool and command family its home says it denies, and nothing else", async () => {
  await withTempDir((home) => {
    for (const [door, verb] of [["tool", "focus"], ["command", "storytree map"], ["tool", "show_plan"]] as const) {
      assert.deepEqual(verdictOf(door, verb, home), { allowed: true }, `${verb} with no arm named`);
    }

    inArm(home, "map-reads-off", { tools: ["focus"], commands: ["storytree map"] });
    for (const [door, verb] of [["tool", "focus"], ["command", "storytree map"], ["command", "storytree map refresh"]] as const) {
      const verdict = verdictOf(door, verb, home);
      assert.equal(verdict.allowed, false, verb);
      assert.deepEqual(verdict.allowed ? undefined : { experiment: verdict.experiment, arm: verdict.arm }, { experiment: "twin-build", arm: "map-reads-off" });
      assert.match(verdict.allowed ? "" : verdict.message, /twin-build.*map-reads-off/);
    }
    for (const [door, verb] of [["tool", "show_plan"], ["tool", "open"], ["command", "storytree mapper"], ["command", "storytree arc show"], ["command", "focus"], ["tool", "storytree map"]] as const) {
      assert.deepEqual(verdictOf(door, verb, home), { allowed: true }, `map-reads-off leaves ${door} ${verb} alone`);
    }

    inArm(home, "reviewer-off", { tools: ["quality_brief"], commands: ["storytree quality"] });
    assert.equal(verdictOf("tool", "quality_brief", home).allowed, false, "an arm no code names denies what its home says");
    assert.deepEqual(verdictOf("tool", "focus", home), { allowed: true }, "and nothing it does not say");

    inArm(home, "map-reads-on", { tools: [], commands: [] });
    assert.deepEqual(verdictOf("tool", "focus", home), { allowed: true }, "the control arm denies nothing");
  });
});

test("1.2 · a home naming an arm but not what it denies is refused, naming the arm and how its run carries them", async () => {
  await withTempDir((home) => {
    inArm(home, "map-reads-off");
    assert.throws(() => verdictOf("tool", "show_plan", home), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /map-reads-off.*twin-build/);
      assert.match(error.message, /storytree experiment run/);
      return true;
    });
  });
});

test("1.3 · an arm's denies are carried into the home that names it, its other settings kept; a home naming no arm or another is refused, written nothing", async () => {
  await withTempDir((home) => {
    const file = path.join(home, "settings.json");
    const library = { location: "postgres", address: "postgres://x-twin-build-map-reads-off@127.0.0.1:5432/storytree_x" };
    writeFileSync(file, JSON.stringify({ library, experiment: { name: "twin-build", arm: "map-reads-off" } }));
    carryDenies(home, "twin-build", "map-reads-off", { tools: ["focus"], commands: ["storytree map"] });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { library, experiment: { name: "twin-build", arm: "map-reads-off", denies: { tools: ["focus"], commands: ["storytree map"] } } });
    assert.equal(verdictOf("tool", "focus", home).allowed, false, "the doors read what was carried");

    const before = readFileSync(file, "utf8");
    assert.throws(() => carryDenies(home, "twin-build", "map-reads-on", { tools: [], commands: [] }), /not the home of arm "map-reads-on"/);
    assert.throws(() => carryDenies(home, "other", "map-reads-off", { tools: [], commands: [] }), /not the home of arm "map-reads-off" of experiment "other"/);
    assert.equal(readFileSync(file, "utf8"), before, "a refused carry writes nothing");
  });
  await withTempDir((home) => {
    assert.throws(() => carryDenies(home, "twin-build", "map-reads-off", { tools: [], commands: [] }), /not the home/, "a home naming no arm");
  });
});
