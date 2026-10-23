import assert from "node:assert/strict";
import { test } from "node:test";

import { logMainErrors, type MainProcess } from "./main-errors.js";

test("1.22 the main process's uncaught exceptions and unhandled rejections reach the app's log with their stack", () => {
  const heard = new Map<string, (reason: unknown) => void>();
  const main: MainProcess = { on: (event: string, listener: (reason: unknown) => void) => { heard.set(event, listener); } };
  const logged: string[] = [];
  logMainErrors(main, { log: line => logged.push(line), ask: async () => "keep-going", restart: () => {} });

  const thrown = new TypeError("Object has been destroyed");
  thrown.stack = "TypeError: Object has been destroyed\n    at titleWindow (main.cjs:12:3)";
  heard.get("uncaughtException")!(thrown);
  heard.get("unhandledRejection")!(new Error("connection reset"));
  heard.get("unhandledRejection")!("not an error");

  assert.equal(logged[0], "main process uncaught exception: TypeError: Object has been destroyed\n    at titleWindow (main.cjs:12:3)");
  assert.match(logged[1]!, /^main process unhandled rejection: Error: connection reset\n {4}at /);
  assert.equal(logged[2], "main process unhandled rejection: not an error");
});

test("1.23 after an uncaught main-process error is logged, the app says so, asks the person to have their agent file a GitHub issue, and offers Keep going or Restart, one box at a time; only Restart restarts it", async () => {
  const heard = new Map<string, (reason: unknown) => void>();
  const main: MainProcess = { on: (event: string, listener: (reason: unknown) => void) => { heard.set(event, listener); } };
  const logged: string[] = [];
  const asked: { detail: string; buttons: readonly string[]; answer: (choice: "keep-going" | "restart") => void }[] = [];
  let restarts = 0;
  logMainErrors(main, {
    log: line => logged.push(line),
    ask: message => new Promise(answer => asked.push({ detail: message.detail, buttons: message.buttons, answer })),
    restart: () => { restarts += 1; },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));

  heard.get("uncaughtException")!(new Error("first"));
  heard.get("uncaughtException")!(new Error("second, while the box is open"));
  assert.equal(logged.length, 2);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0]!.buttons, ["Keep going", "Restart"]);
  assert.match(asked[0]!.detail, /ask your agent to submit a GitHub issue on github\.com\/storytree-ai\/storytree/);
  assert.match(asked[0]!.detail, /we'll work on it/);

  asked[0]!.answer("keep-going");
  await settle();
  assert.equal(restarts, 0);

  heard.get("uncaughtException")!(new Error("third"));
  assert.equal(asked.length, 2);
  asked[1]!.answer("restart");
  await settle();
  assert.equal(restarts, 1);

  heard.get("unhandledRejection")!(new Error("a rejection is only logged"));
  assert.equal(asked.length, 2);
});
