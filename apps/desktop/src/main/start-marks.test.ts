import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appLog } from "./app-log.js";
import { answerStartMarks, startMarks } from "./start-marks.js";

test("1.33 · a start writes each timing mark once to app.log, as milliseconds from launch", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "start-marks-")), "app.log");
  const marks = startMarks({ launchedAt: 1_000, log: appLog(file), now: () => 1_250 });
  marks.mark("app ready");
  marks.mark("forest first fresh draw", 3_400.6);
  marks.mark("app ready", 9_000);
  marks.mark("forest first fresh draw", 9_000);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.deepEqual(lines.map((line) => line.replace(/^\S+ /, "")), ["start mark: app ready +250 ms", "start mark: forest first fresh draw +2401 ms"]);
  assert.match(lines[0]!, /^\d{4}-\d{2}-\d{2}T\S+Z /, "each line carries the time it was written");
});

test("1.33 · the page's marks reach app.log through the main process; a malformed one is ignored", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "start-marks-")), "app.log");
  const answers = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  answerStartMarks({ handle: (channel, answer) => answers.set(channel, answer) }, "start-mark", startMarks({ launchedAt: 1_000, log: appLog(file) }));
  const answer = answers.get("start-mark")!;
  answer({}, "kept reading read start", "soon");
  answer({}, 42, 1_500);
  answer({}, "kept reading read start", 1_120);
  assert.deepEqual(readFileSync(file, "utf8").trim().split("\n").map((line) => line.replace(/^\S+ /, "")), ["start mark: kept reading read start +120 ms"]);
});
