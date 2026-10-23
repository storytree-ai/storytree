import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startMarks } from "./start-marks.js";

test("1.33 · a start writes each timing mark once to app.log, as milliseconds from launch", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "start-marks-")), "app.log");
  const marks = startMarks({ launchedAt: 1_000, file, now: () => 1_250 });
  marks.mark("app ready");
  marks.mark("forest first fresh draw", 3_400.6);
  marks.mark("app ready", 9_000);
  marks.mark("forest first fresh draw", 9_000);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.deepEqual(lines.map((line) => line.replace(/^\S+ /, "")), ["start mark: app ready +250 ms", "start mark: forest first fresh draw +2401 ms"]);
  assert.match(lines[0]!, /^\d{4}-\d{2}-\d{2}T\S+Z /, "each line carries the time it was written");
});

test("1.33 · a mark that cannot be written never stops the app", () => {
  const marks = startMarks({ launchedAt: 0, file: path.join(tmpdir(), "no-such-dir", "nested", "app.log") });
  assert.doesNotThrow(() => marks.mark("app ready"));
});
