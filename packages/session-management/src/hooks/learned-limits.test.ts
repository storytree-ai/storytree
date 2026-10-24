/** Capability 3 · Hooks, contract 3.47: a hook's Git and storytree steps learn this machine's speed (ADR-1163 D2). */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mock, test } from "node:test";

import { git, withTempDir } from "@storytree/project-and-caller/testing/folders";
import { runGit, type Git } from "../activity/git.js";
import { AFTER_TOOL } from "./at-once.js";
import { TOOL_GRACE_MS } from "./codex-delivery.js";
import { DEADLINE_MS, GUARDED_DEADLINE_MS, hookDeadline } from "./deadlines.js";
import { EDIT_GATE, EDIT_GATE_STEP, editGate } from "./edit-gate.js";
import { learn, LEARNED_FILE, limitOf, withinLimit } from "./learned-limits.js";
import { OBSERVE_STEP, shellEdits } from "./shell-edits.js";
import { SHELL_GUARD, SHELL_GUARD_STEP } from "./shell-guard.js";

test("3.47 a step's limit is its floor on a new machine, three times its slowest recent time once it has a few, never above its ceiling, and a give-up learned at its limit widens it", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    for (const step of [EDIT_GATE_STEP, SHELL_GUARD_STEP, OBSERVE_STEP]) {
      assert.equal(limitOf(home, step), step.floorMs, `${step.name}: a new machine uses the floor`);
      assert.ok(step.ceilingMs > step.floorMs, `${step.name}: the ceiling leaves room to widen`);
    }
    // A fast machine keeps today's limit.
    for (let i = 0; i < 3; i++) learn(home, EDIT_GATE_STEP, 150);
    assert.equal(limitOf(home, EDIT_GATE_STEP), EDIT_GATE_STEP.floorMs);
    // A slow machine widens: three times its slowest recent time.
    learn(home, SHELL_GUARD_STEP, 1_200);
    learn(home, SHELL_GUARD_STEP, 1_500);
    assert.equal(limitOf(home, SHELL_GUARD_STEP), SHELL_GUARD_STEP.floorMs, "two times are too few to learn from");
    learn(home, SHELL_GUARD_STEP, 1_400);
    assert.equal(limitOf(home, SHELL_GUARD_STEP), 4_500);
    // A machine that gave up three times, each learned at the limit it had, reaches the ceiling and no further.
    for (let i = 0; i < 3; i++) learn(home, EDIT_GATE_STEP, limitOf(home, EDIT_GATE_STEP));
    assert.equal(limitOf(home, EDIT_GATE_STEP), EDIT_GATE_STEP.ceilingMs);
    // Steps learn apart, and a file that cannot be read gives the floor.
    assert.equal(limitOf(home, OBSERVE_STEP), OBSERVE_STEP.floorMs);
    writeFileSync(path.join(home, LEARNED_FILE), "not json");
    assert.equal(limitOf(home, SHELL_GUARD_STEP), SHELL_GUARD_STEP.floorMs);
  });
});

test("3.47 the edit gate and the shell guard may run 9 s, inside Codex's 10 s; an ordinary hook is given what the observation learned over its floor", () => {
  for (const flag of [EDIT_GATE, SHELL_GUARD]) assert.equal(hookDeadline([flag]), GUARDED_DEADLINE_MS);
  assert.ok(EDIT_GATE_STEP.ceilingMs < GUARDED_DEADLINE_MS && SHELL_GUARD_STEP.ceilingMs < GUARDED_DEADLINE_MS);
  assert.ok(GUARDED_DEADLINE_MS < 10_000);
  assert.equal(hookDeadline([]), DEADLINE_MS);
  assert.equal(hookDeadline([], OBSERVE_STEP.floorMs + 2_000), DEADLINE_MS + 2_000);
  assert.equal(hookDeadline([], 60_000), DEADLINE_MS + OBSERVE_STEP.ceilingMs - OBSERVE_STEP.floorMs);
  assert.equal(hookDeadline([AFTER_TOOL], OBSERVE_STEP.floorMs + 1_000), DEADLINE_MS + 1_000 + TOOL_GRACE_MS);
});

test("3.47 a shell-edit observation's Git reads get the time this machine learned, and one that runs out of time is learned at its limit", async () => {
  await withTempDir((dir) => {
    const home = path.join(dir, "home");
    const root = path.join(dir, "work");
    mkdirSync(root);
    git(root, "init", "-b", "main");
    const line = { session: "one", harness: "codex", source: "hook", kind: "session-started", folder: root } as const;
    const given: number[] = [];
    const watching: Git = (args, options) => {
      given.push(options.timeout ?? 0);
      return runGit(args, options);
    };

    shellEdits(home, root, line, () => undefined, watching);
    assert.ok(given.every((timeout) => timeout <= OBSERVE_STEP.floorMs), "a new machine's reads share the floor");
    const learned = JSON.parse(readFileSync(path.join(home, LEARNED_FILE), "utf8")) as Record<string, number[]>;
    assert.equal(learned[OBSERVE_STEP.name]?.length, 1, "the observation's own time is learned");

    // A slow machine: its observations took 2 s.
    for (let i = 0; i < 3; i++) learn(home, OBSERVE_STEP, 2_000);
    given.length = 0;
    shellEdits(home, root, line, () => undefined, watching);
    assert.ok(given[0]! > OBSERVE_STEP.floorMs && given[0]! <= 6_000, `the first read is given the learned 6 s, not the floor (${given[0]})`);

    // Reads that run out of the observation's time are learned at its whole limit.
    const limit = limitOf(home, OBSERVE_STEP);
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      const failures: unknown[] = [];
      shellEdits(home, root, line, (error) => failures.push(error), () => {
        mock.timers.tick(limit);
        throw new Error("timed out");
      });
      assert.equal(failures.length, 1);
    } finally {
      mock.timers.reset();
    }
    const after = JSON.parse(readFileSync(path.join(home, LEARNED_FILE), "utf8")) as Record<string, number[]>;
    assert.equal(after[OBSERVE_STEP.name]?.at(-1), limit);
    assert.equal(limitOf(home, OBSERVE_STEP), OBSERVE_STEP.ceilingMs);
  });
});

test("3.47 a guarded step that runs out of its limit answers late and is learned at that limit; one that answers in time is learned at its own time; a limit a test gives learns nothing", async () => {
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const learned = () => (JSON.parse(readFileSync(path.join(home, LEARNED_FILE), "utf8")) as Record<string, number[]>)[EDIT_GATE_STEP.name] ?? [];
    const limit = limitOf(home, EDIT_GATE_STEP);
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = withinLimit(EDIT_GATE_STEP, limit, home, () => new Promise<string>(() => undefined));
      mock.timers.tick(limit);
      assert.deepEqual(await pending, { late: true });
    } finally {
      mock.timers.reset();
    }
    assert.deepEqual(learned(), [limit]);

    assert.deepEqual(await withinLimit(EDIT_GATE_STEP, limit, home, async () => "refused"), { late: false, answer: "refused" });
    assert.equal(learned().length, 2);
    assert.ok(learned()[1]! < limit, "a quick answer is learned at its own time");
    await withinLimit(EDIT_GATE_STEP, 60_000, undefined, async () => "refused");
    assert.equal(learned().length, 2, "a given limit learns nothing");
  });
});

test("3.47 the edit gate learns how long its answer took in the home it is given, unless a limit is given it", async () => {
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const edit = { hook_event_name: "PreToolUse", session_id: "one", cwd: dir, tool_name: "Write", tool_input: { file_path: path.join(dir, "a.ts"), content: "" } };
    const declared = async () => new Map<string, string>();
    assert.equal(await editGate("claude-code", edit, declared, { home }, home, () => undefined, 60_000), undefined);
    assert.equal(limitOf(home, EDIT_GATE_STEP), EDIT_GATE_STEP.floorMs);
    assert.throws(() => readFileSync(path.join(home, LEARNED_FILE)), "a given limit learns nothing");
    assert.equal(await editGate("claude-code", edit, declared, { home }, home, () => undefined), undefined);
    const learned = JSON.parse(readFileSync(path.join(home, LEARNED_FILE), "utf8")) as Record<string, number[]>;
    assert.equal(learned[EDIT_GATE_STEP.name]?.length, 1);
  });
});
