/** The command line 14.6 and 14.9: a window read from a project's activity log, against a real Postgres. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog } from "@storytree/session-management";
import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { readDoors, readLearned } from "./read.js";

test("14.6 · each window counts only its own door-answered lines, and a session's prompts decide whether it was briefed", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    const common = { harness: "codex", source: "tool", machine: "box" } as const;
    const answered = (session: string, verb: string, at: string) =>
      log.append(project, { ...common, session, kind: "door-answered", door: "command", verb, outcome: "answered", next: [] }, { at });
    await answered("old", "storytree arc show", "2026-09-20T00:00:00.000Z");
    await answered("lane", "storytree arc show", "2026-10-05T00:00:00.000Z");
    await answered("owner", "storytree arc list", "2026-10-06T00:00:00.000Z");
    await answered("late", "storytree arc show", "2026-10-09T00:00:00.000Z");
    await log.append(project, { ...common, session: "lane", kind: "tool-called", tool: "show_plan" }, { at: "2026-10-05T00:00:01.000Z" });
    for (const at of ["2026-10-06T00:00:00.000Z", "2026-10-06T00:01:00.000Z"]) await log.append(project, { ...common, session: "owner", kind: "prompt-submitted" }, { at });

    const [week, month] = await readDoors(log, project, { commands: ["storytree arc show", "storytree arc list"].map((verb) => ({ verb, consumers: ["agent"] as const })), tools: [{ verb: "show_plan", consumers: ["agent"] as const }] }, new Date("2026-10-08T00:00:00.000Z"), [7, 28]);
    assert.equal(week?.since, "2026-10-01T00:00:00.000Z");
    assert.equal(week?.until, "2026-10-08T00:00:00.000Z");
    assert.deepEqual(week?.calls, { command: 2, tool: 0 }, "a tool-called line is not an answer, and a line past the window's end is left out");
    assert.deepEqual(month?.calls, { command: 3, tool: 0 });
    const briefed = week?.splits.filter((split) => split.by === "briefed").map(({ value, sessions }) => [value, sessions]);
    assert.deepEqual(briefed, [["briefed", 1], ["not briefed", 1]]);
  } finally {
    await log.close();
  }
});

test("14.9 · a refused word learns from its own sessions' next calls over the 28 days before, read from the project's activity log", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    const common = { harness: "codex", source: "tool", machine: "box" } as const;
    let second = 0;
    const answer = (session: string, verb: string, day: string, more: { outcome?: "unknown"; word?: string } = {}) =>
      log.append(project, { ...common, session, kind: "door-answered", door: "command", verb, outcome: "answered", next: [], ...more }, { at: `${day}T00:00:${String(second++).padStart(2, "0")}.000Z` });
    await answer("old", "storytree adr", "2026-09-01", { outcome: "unknown", word: "show" });
    await answer("old", "storytree adr pull", "2026-09-01");
    await answer("a", "storytree adr", "2026-10-05", { outcome: "unknown", word: "show" });
    await answer("a", "storytree library search", "2026-10-05");
    await answer("b", "storytree adr", "2026-10-06", { outcome: "unknown", word: "show" });
    await answer("b", "storytree adr list", "2026-10-06");
    await answer("other", "storytree arc show", "2026-10-06");

    assert.deepEqual(await readLearned(log, project, "storytree adr", "show", new Date("2026-10-08T00:00:00.000Z")), [
      { verb: "storytree adr list", count: 1 }, { verb: "storytree library search", count: 1 },
    ], "the September refusal is past the 28 days");
    assert.deepEqual(await readLearned(log, project, "storytree adr", "nope", new Date("2026-10-08T00:00:00.000Z")), []);
  } finally {
    await log.close();
  }
});
