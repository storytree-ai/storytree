import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { appLog } from "./app-log.js";
import { logPageErrors, type PageContents } from "./page-errors.js";

/** app.log's entries, split at each one's timestamp, since a stack runs over several lines. */
function entries(file: string): string[] {
  return readFileSync(file, "utf8").split(/^\d{4}-\d\d-\d\dT\S+Z /m).slice(1).map(entry => entry.replace(/\n$/, ""));
}

test("1.19 the page's console errors and its renderer going away reach app.log with where they came from; its ordinary logging does not", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "page-errors-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "app.log");
  const heard = new Map<string, (...args: never[]) => void>();
  const contents = { on: (event: string, listener: (...args: never[]) => void) => { heard.set(event, listener); } } as unknown as PageContents;
  const log = appLog(file);
  logPageErrors(contents, line => log.write(line));
  const message = heard.get("console-message") as (details: { level: string; message: string; sourceId: string; lineNumber: number }) => void;
  message({ level: "info", message: "drawn", sourceId: "file:///app/renderer.js", lineNumber: 3 });
  message({ level: "warning", message: "slow", sourceId: "file:///app/renderer.js", lineNumber: 4 });
  message({ level: "error", message: "storytree sessions list: reading the arcs failed: Error: connection reset", sourceId: "file:///app/renderer.js", lineNumber: 812 });
  (heard.get("render-process-gone") as (event: unknown, details: { reason: string; exitCode: number }) => void)({}, { reason: "oom", exitCode: 9 });
  assert.deepEqual(entries(file), [
    "page error (file:///app/renderer.js:812): storytree sessions list: reading the arcs failed: Error: connection reset",
    "page's renderer gone: oom (exit code 9)",
  ]);
});
