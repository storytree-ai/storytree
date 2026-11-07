/**
 * Capability 4 · Sessions: what the library sent each reader on a day, read back per machine (increment_28a5cea44ef7).
 * Totals go to the real agent activity log on the Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { giveBackReads, takeReads } from "@storytree/library/reads";

import { openActivityLog } from "../activity/index.js";
import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";

import { libraryReads } from "./library-reads.js";

test("4.45 · a day's library reads read back for a machine: its total, and each reader's bytes and statements, the most bytes first", async () => {
  const machine = `${uniqueProjectName()}-laptop`;
  const today = new Date().toISOString().slice(0, 10);
  const log = await openActivityLog(testServerUrl(), { machine });
  try {
    takeReads();
    giveBackReads([{ reader: "hook PostToolUse", bytes: 2_500_000, statements: 40 }, { reader: "arc show", bytes: 7_000_000, statements: 3 }]);
    await log.reads.record();

    assert.deepEqual(JSON.parse(await libraryReads(log, { machine, json: true })), [
      { day: today, machine, reader: "arc show", bytes: 7_000_000, statements: 3 },
      { day: today, machine, reader: "hook PostToolUse", bytes: 2_500_000, statements: 40 },
    ]);
    const text = await libraryReads(log, { machine });
    assert.match(text, new RegExp(`${machine}\\s+9\\.5 MB\\s+43 statements[\\s\\S]*arc show\\s+7\\.0 MB\\s+3[\\s\\S]*hook PostToolUse\\s+2\\.5 MB\\s+40`));
    assert.match(await libraryReads(log, { machine, day: "2001-01-01" }), /No library reads recorded on 2001-01-01/);
  } finally {
    await log.close();
  }
});
