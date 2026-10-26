/**
 * Capability 4 · Sessions: the hook times read back (ADR-1056 D1). Lines go to the real agent activity log on the
 * Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openActivityLog } from "../activity/index.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { hookTimes } from "./hook-times.js";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

test("4.35 · the hook times read back for each harness, event and machine: count, median, 75th percentile and worst total with each part's median, the worst first, over the days asked; the readings make no session read live (ADR-1056 D1)", async () => {
  const project = uniqueProjectName();
  const log = await openActivityLog(testServerUrl());
  try {
    const reading = (event: string, total: number, at = ago(1)) => ({ at, harness: "codex", event, total, parts: { startup: total / 2, connect: total / 4 } });
    await log.append(project, { session: "uploader", source: "hook", machine: "mint", kind: "hook-times",
      readings: [reading("PostToolUse", 100), reading("PostToolUse", 300), reading("PostToolUse", 200), reading("PostToolUse", 900), reading("Stop --background", 50), reading("PostToolUse", 5_000, ago(9))] });
    await log.append(project, { session: "uploader", source: "hook", machine: "laptop", kind: "hook-times", readings: [reading("PostToolUse", 400)] });

    assert.deepEqual(JSON.parse(await hookTimes(log, project, { json: true, now: NOW })), [
      { harness: "codex", event: "PostToolUse", machine: "mint", count: 4, median: 200, p75: 300, worst: 900, parts: { startup: 100, connect: 50 } },
      { harness: "codex", event: "PostToolUse", machine: "laptop", count: 1, median: 400, p75: 400, worst: 400, parts: { startup: 200, connect: 100 } },
      { harness: "codex", event: "Stop --background", machine: "mint", count: 1, median: 50, p75: 50, worst: 50, parts: { startup: 25, connect: 12.5 } },
    ]);
    assert.equal(JSON.parse(await hookTimes(log, project, { json: true, now: NOW, days: 10 }))[0].worst, 5_000, "--days reaches further back");
    assert.match(await hookTimes(log, project, { now: NOW }), /codex\s+PostToolUse\s+mint\s+4\s+200 \/ 300 \/ 900/);
    assert.equal(await log.sessionCount(project), 0, "no session reads live from readings it only carried");
  } finally {
    await log.close();
    await dropTestProjects([project]);
  }
});
