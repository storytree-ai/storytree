/** Capability 1 · Arm switch: every home here is a throwaway folder, its settings written by the test. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { ARMS, verdictOf } from "./index.js";

function inArm(home: string, arm: string): void {
  writeFileSync(path.join(home, "settings.json"), JSON.stringify({ experiment: { name: "twin-build", arm } }));
}

test("1.1 · a verb's verdict is read from the caller's storytree home: none named allows every verb; map-reads-off denies the focus tool and every map command, and nothing else", async () => {
  await withTempDir((home) => {
    for (const [door, verb] of [["tool", "focus"], ["command", "storytree map"], ["tool", "show_plan"]] as const) {
      assert.deepEqual(verdictOf(door, verb, home), { allowed: true }, `${verb} with no arm named`);
    }

    inArm(home, "map-reads-off");
    for (const [door, verb] of [["tool", "focus"], ["command", "storytree map"], ["command", "storytree map refresh"]] as const) {
      const verdict = verdictOf(door, verb, home);
      assert.equal(verdict.allowed, false, verb);
      assert.deepEqual(verdict.allowed ? undefined : { experiment: verdict.experiment, arm: verdict.arm }, { experiment: "twin-build", arm: "map-reads-off" });
      assert.match(verdict.allowed ? "" : verdict.message, /twin-build.*map-reads-off/);
    }
    for (const [door, verb] of [["tool", "show_plan"], ["tool", "open"], ["command", "storytree mapper"], ["command", "storytree arc show"], ["command", "focus"], ["tool", "storytree map"]] as const) {
      assert.deepEqual(verdictOf(door, verb, home), { allowed: true }, `map-reads-off leaves ${door} ${verb} alone`);
    }

    inArm(home, "map-reads-on");
    assert.deepEqual(verdictOf("tool", "focus", home), { allowed: true }, "the control arm denies nothing");
  });
});

test("1.2 · a home naming an arm the kit does not hold is refused, naming the arm and the arms it holds", async () => {
  await withTempDir((home) => {
    inArm(home, "map-reads-of");
    assert.throws(() => verdictOf("tool", "show_plan", home), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /map-reads-of/);
      for (const known of Object.keys(ARMS)) assert.ok(error.message.includes(known), `names ${known}: ${error.message}`);
      return true;
    });
  });
});
