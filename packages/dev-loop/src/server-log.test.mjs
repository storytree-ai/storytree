// increment_5297d1d7c3e7: a run's start keeps the previous run's server log, so the rerun that
// follows a red run leaves the red run's log readable.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { keepPreviousServerLog } from "./server-log.mjs";

function workDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "server-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("6.4 a run's start keeps the previous run's server log readable, and clears the way for its own", (t) => {
  const dir = workDir(t);
  const serverLog = path.join(dir, "pg.log");
  writeFileSync(serverLog, "the red run's server lines\n");
  const kept = keepPreviousServerLog(serverLog);
  assert.equal(existsSync(serverLog), false);
  assert.equal(readFileSync(kept, "utf8"), "the red run's server lines\n");
});

test("6.4 only one previous log is kept: the next run's start replaces it", (t) => {
  const dir = workDir(t);
  const serverLog = path.join(dir, "pg.log");
  writeFileSync(serverLog, "first\n");
  keepPreviousServerLog(serverLog);
  writeFileSync(serverLog, "second\n");
  const kept = keepPreviousServerLog(serverLog);
  assert.equal(readFileSync(kept, "utf8"), "second\n");
  assert.deepEqual(readdirSync(dir), [path.basename(kept)]);
});

test("6.4 a start with no server log to keep leaves the kept one as it was", (t) => {
  const dir = workDir(t);
  const serverLog = path.join(dir, "pg.log");
  writeFileSync(serverLog, "red\n");
  const kept = keepPreviousServerLog(serverLog);
  assert.equal(keepPreviousServerLog(serverLog), undefined);
  assert.equal(readFileSync(kept, "utf8"), "red\n");
});
