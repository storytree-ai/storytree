/** Capability 3 · Hooks, contract 3.53: waiting lines upload in batches, so a backlog over a wss:// library takes a few round trips, not six a line. */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mock, test } from "node:test";

import type { NewLine } from "@storytree/library";
import pg from "pg";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { openActivityLog } from "../activity/index.js";
import { enqueue, queueFolder, uploadQueued } from "./queue.js";

test("3.53 a backlog of a hundred and twenty waiting lines uploads in a few round trips, every line once and in order, and each file is forgotten once its lines are in", async () => {
  const project = uniqueProjectName();
  const log = await openActivityLog(testServerUrl());
  try {
    await withTempDir(async (home) => {
      const line = (index: number): NewLine => ({ session: `${project}-s`, harness: "claude-code", source: "hook", kind: "command-run", folder: "/work", command: `step ${index}` });
      // A file's name starts with its millisecond, so files a millisecond apart sort in the order they were written.
      mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-02T00:00:00.000Z") });
      try {
        for (let file = 0; file < 30; file += 1) {
          enqueue(home, project, [0, 1, 2, 3].map((at) => line(file * 4 + at)));
          mock.timers.tick(1);
        }
      } finally {
        mock.timers.reset();
      }
      enqueue(home, project, [{ ...line(999), folder: "/not-approved" }]);

      const query = pg.Client.prototype.query;
      let sent = 0;
      pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
        sent += 1;
        return (query as (...given: unknown[]) => unknown).apply(this, args);
      } as typeof query;
      try {
        await uploadQueued(home, log, async (_, folder) => folder === "/work");
      } finally {
        pg.Client.prototype.query = query;
      }

      const lines = (await log.since(project, 0)).lines;
      assert.deepEqual(lines.map((written) => (written.kind === "command-run" ? written.command : written.kind)), Array.from({ length: 120 }, (_, index) => `step ${index}`), "every approved line, once, oldest first");
      assert.ok(sent <= 12, `a hundred and twenty lines took ${sent} round trips`);
      assert.deepEqual(readdirSync(queueFolder(home)).filter((name) => name.endsWith(".jsonl")), [], "nothing left waiting");
    });
  } finally {
    await log.close();
    await dropTestProjects([project]);
  }
});
