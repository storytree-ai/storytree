/**
 * Capability 2 · Agent activity log, contract 2.15: what a process's library connections read is kept beside the log as
 * one total per machine, reader and day, never a line per statement (increment_28a5cea44ef7).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { giveBackReads, takeReads } from "@storytree/library/reads";

import { testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { openActivityLog } from "./index.js";

test("2.15 a log records what this process read from the library as one total per machine, reader and day, adds each later process's to it, records what is left as it closes, even side by side with its connection, keeps for the next record what one could not write, and reads back a day's totals the most first", async () => {
  const machine = `${uniqueProjectName()}-box`;
  const today = new Date().toISOString().slice(0, 10);
  const first = await openActivityLog(testServerUrl(), { machine });
  try {
    takeReads();
    giveBackReads([{ reader: "arc show", bytes: 1_000, statements: 2 }, { reader: "tool show_plan", bytes: 300, statements: 1 }]);
    await first.reads.record();
    // A later process on the same machine and day adds to the same totals.
    giveBackReads([{ reader: "arc show", bytes: 500, statements: 1 }]);
    await first.reads.record();
    // A log that closes records what was read since its last record, closed side by side with its connection too.
    const storytree = await connect({ url: testServerUrl() });
    const second = await openActivityLog(storytree, { machine });
    giveBackReads([{ reader: "tool show_plan", bytes: 2_000, statements: 4 }]);
    await Promise.all([second.close(), storytree.close()]);

    const day = (await first.reads.day(today)).filter((row) => row.machine === machine && ["arc show", "tool show_plan"].includes(row.reader));
    assert.deepEqual(day, [
      { day: today, machine, reader: "tool show_plan", bytes: 2_300, statements: 5 },
      { day: today, machine, reader: "arc show", bytes: 1_500, statements: 3 },
    ]);
    assert.deepEqual((await first.reads.day("2001-01-01")).filter((row) => row.machine === machine), [], "another day's totals are its own");

    // A record that cannot be written keeps its totals for the next.
    const gone = await openActivityLog(testServerUrl(), { machine });
    await gone.close();
    takeReads();
    giveBackReads([{ reader: "kept", bytes: 10, statements: 1 }]);
    await assert.rejects(gone.reads.record());
    assert.deepEqual(takeReads(), [{ reader: "kept", bytes: 10, statements: 1 }]);
  } finally {
    await first.close();
  }
});
