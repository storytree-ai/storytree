import assert from "node:assert/strict";
import { test } from "node:test";

import { logPageErrors, type PageContents } from "./page-errors.js";

test("1.19 the page's console errors and its renderer going away reach the app's log with where they came from; its ordinary logging does not", () => {
  const heard = new Map<string, (...args: never[]) => void>();
  const contents = { on: (event: string, listener: (...args: never[]) => void) => { heard.set(event, listener); } } as unknown as PageContents;
  const logged: string[] = [];
  logPageErrors(contents, line => logged.push(line));
  const message = heard.get("console-message") as (details: { level: string; message: string; sourceId: string; lineNumber: number }) => void;
  message({ level: "info", message: "drawn", sourceId: "file:///app/renderer.js", lineNumber: 3 });
  message({ level: "warning", message: "slow", sourceId: "file:///app/renderer.js", lineNumber: 4 });
  message({ level: "error", message: "storytree sessions list: reading the arcs failed: Error: connection reset", sourceId: "file:///app/renderer.js", lineNumber: 812 });
  (heard.get("render-process-gone") as (event: unknown, details: { reason: string; exitCode: number }) => void)({}, { reason: "oom", exitCode: 9 });
  assert.deepEqual(logged, [
    "page error (file:///app/renderer.js:812): storytree sessions list: reading the arcs failed: Error: connection reset",
    "page's renderer gone: oom (exit code 9)",
  ]);
});
