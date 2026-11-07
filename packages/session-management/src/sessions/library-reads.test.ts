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

test("4.45 · a day's library reads read back by machine, or for one: each machine's total, then each reader's bytes and statements, the most bytes first; a day that is no day is refused", async () => {
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
    await assert.rejects(libraryReads(log, { day: "2026-13-45" }), RangeError, "a day that is no day is refused");

    // Every machine's readers, each machine under its own total.
    const box = await openActivityLog(testServerUrl(), { machine: `${machine}-box` });
    try {
      takeReads();
      giveBackReads([{ reader: "tool show_plan", bytes: 3_000_000_000, statements: 9 }, { reader: "hook Stop", bytes: 500, statements: 1 }]);
      await box.reads.record();
    } finally {
      takeReads(); // the test's own reads stay off the box's totals
      await box.close();
    }
    const all = await libraryReads(log);
    assert.match(all, new RegExp(`${machine}\\s+9\\.5 MB`));
    assert.match(all, new RegExp(`${machine}-box\\s+3\\.00 GB\\s+10 statements\\n\\s+tool show_plan\\s+3\\.00 GB\\s+9\\n\\s+hook Stop\\s+500 B\\s+1`));
  } finally {
    await log.close();
  }
});
