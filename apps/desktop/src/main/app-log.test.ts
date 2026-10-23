import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appLog, teeConsole } from "./app-log.js";

test("1.34 · what the app logs and errors is still said, and also kept in app.log, each entry stamped with its time", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "app.log");
  const said: string[] = [];
  const target = { log: (...parts: unknown[]) => said.push(`log ${parts.join(" ")}`), error: (...parts: unknown[]) => said.push(`error ${parts.join(" ")}`) };
  teeConsole(target, appLog(file));

  target.log("storytree 0.3 started", 2);
  target.error("closing the library: %s", "connection reset");

  assert.deepEqual(said, ["log storytree 0.3 started 2", "error closing the library: %s connection reset"]);
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.deepEqual(lines.map(line => line.replace(/^\d{4}-\d\d-\d\dT\S+Z /, "")), ["storytree 0.3 started 2", "closing the library: connection reset"]);
});

test("1.34 · app.log stays under its cap: past it, the file starts again and the previous one is kept beside it", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "app-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "app.log");
  const log = appLog(file, { capBytes: 1_000 });

  for (let i = 0; i < 200; i++) log.write(`page error (file:///app/renderer.js:${i}): reading the arcs failed`);

  assert.ok(statSync(file).size <= 1_000);
  assert.ok(statSync(`${file}.1`).size <= 1_000);
  assert.match(readFileSync(file, "utf8"), /renderer\.js:199\): reading the arcs failed\n$/);
});

test("1.34 · a log that cannot be written never stops the app", () => {
  const log = appLog(path.join(tmpdir(), "no-such-dir", "nested", "app.log"));
  assert.doesNotThrow(() => log.write("storytree 0.3 started"));
});
