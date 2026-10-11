/** Reading the front doors 1.6: a window read from a project's activity log, against a real Postgres. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog } from "@storytree/session-management";
import { testServerUrl, uniqueProjectName } from "@storytree/session-management/testing/pg";

import { readDoors } from "./read.js";

test("1.6 · each window counts only its own door-answered lines, and a session's prompts decide whether it was briefed", async () => {
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

    const [week, month] = await readDoors(log, project, { commands: ["storytree arc show", "storytree arc list"], tools: ["show_plan"] }, new Date("2026-10-08T00:00:00.000Z"), [7, 28]);
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
