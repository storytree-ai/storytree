/** Capability 4 · Sessions, a machine's start: the line every reader judges a restart's dead sessions by (contract 4.29). */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { openActivityLog } from "../activity/index.js";
import { testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { recordMachineStart } from "./machine-start.js";

test("4.30 the first hook on a machine to reach a project's log after the machine starts records that start there, once: a later hook, reading the same start a moment apart, writes nothing; the next start, or another project, is recorded again", async () => {
  const log = await openActivityLog(testServerUrl());
  try {
    const home = await mkdtemp(path.join(tmpdir(), "machine-start-"));
    const [project, other] = [uniqueProjectName(), uniqueProjectName()];
    const by = { session: "lane-1", harness: "codex" };
    const booted = { machine: "mint", at: new Date("2026-10-06T10:52:00.000Z") };
    const first = await recordMachineStart(home, log, project, by, booted);
    assert.equal(first?.kind, "machine-started");
    assert.deepEqual(first?.kind === "machine-started" && { machine: first.machine, startedAt: first.startedAt, session: first.session }, { machine: "mint", startedAt: booted.at.toISOString(), session: "lane-1" });
    assert.equal(await recordMachineStart(home, log, project, { session: "lane-2" }, { machine: "mint", at: new Date(booted.at.getTime() + 800) }), undefined, "the same start, read again");
    const rebooted = { machine: "mint", at: new Date("2026-10-06T11:35:00.000Z") };
    assert.equal((await recordMachineStart(home, log, project, by, rebooted))?.kind, "machine-started", "the next start");
    assert.equal((await recordMachineStart(home, log, other, by, rebooted))?.kind, "machine-started", "another project");
    const { lines } = await log.since(project, 0);
    assert.deepEqual(lines.map((line) => line.kind === "machine-started" && line.startedAt), [booted.at.toISOString(), rebooted.at.toISOString()]);
  } finally {
    await log.close();
  }
});
