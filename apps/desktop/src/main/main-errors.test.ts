import assert from "node:assert/strict";
import { test } from "node:test";

import { logMainErrors, type MainProcess } from "./main-errors.js";

test("1.22 the main process's uncaught exceptions and unhandled rejections reach the app's log with their stack; an uncaught exception still shows an error dialog", () => {
  const heard = new Map<string, (reason: unknown) => void>();
  const main: MainProcess = { on: (event: string, listener: (reason: unknown) => void) => { heard.set(event, listener); } };
  const logged: string[] = [];
  const shown: [string, string][] = [];
  logMainErrors(main, { log: line => logged.push(line), showError: (title, content) => shown.push([title, content]) });

  const thrown = new TypeError("Object has been destroyed");
  thrown.stack = "TypeError: Object has been destroyed\n    at titleWindow (main.cjs:12:3)";
  heard.get("uncaughtException")!(thrown);
  heard.get("unhandledRejection")!(new Error("connection reset"));
  heard.get("unhandledRejection")!("not an error");

  assert.equal(logged[0], "main process uncaught exception: TypeError: Object has been destroyed\n    at titleWindow (main.cjs:12:3)");
  assert.match(logged[1]!, /^main process unhandled rejection: Error: connection reset\n {4}at /);
  assert.equal(logged[2], "main process unhandled rejection: not an error");
  assert.deepEqual(shown, [["A JavaScript error occurred in the main process", "Uncaught Exception:\nTypeError: Object has been destroyed\n    at titleWindow (main.cjs:12:3)"]]);
});
