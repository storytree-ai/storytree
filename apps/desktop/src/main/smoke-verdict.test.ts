import assert from "node:assert/strict";
import { test } from "node:test";

import { smokeVerdict } from "./smoke-verdict.js";

test("1.30 · in a smoke check any main-process error turns the exit red, one raised while the app quits included; outside one the chosen code stands", async () => {
  const logged: string[] = [];
  const smoke = smokeVerdict({ smoke: true, log: line => logged.push(line) });
  assert.equal(smoke.exitCode(0), 0, "with no error the smoke check's own verdict stands");
  smoke.error("main process uncaught exception: TypeError: Object has been destroyed");
  assert.equal(smoke.exitCode(0), 1);
  assert.equal(smoke.exitCode(1), 1);

  const quitting = smokeVerdict({ smoke: true, log: line => logged.push(line) });
  await quitting.stopping("the pages", () => { throw new TypeError("Object has been destroyed"); });
  await quitting.stopping("the database", async () => { throw new Error("connection reset"); });
  assert.equal(quitting.exitCode(0), 1, "an error thrown after the quit began still turns it red");
  assert.ok(logged.some(line => line.includes("stopping the pages") && line.includes("Object has been destroyed")));
  assert.ok(logged.some(line => line.includes("stopping the database") && line.includes("connection reset")));

  const ordinary = smokeVerdict({ smoke: false, log: line => logged.push(line) });
  ordinary.error("main process unhandled rejection: connection reset");
  await ordinary.stopping("the pages", () => { throw new Error("gone"); });
  assert.equal(ordinary.exitCode(0), 0, "an ordinary quit keeps its code");
});

test("1.30 · a smoke check never waits on an error box: it keeps going; an ordinary run asks", async () => {
  let shown = 0;
  const box = async () => { shown++; return "restart" as const; };
  const smoke = smokeVerdict({ smoke: true, log: () => {} });
  assert.equal(await smoke.asking(box)({ title: "t", message: "m", detail: "d", buttons: ["Keep going", "Restart"] }), "keep-going");
  assert.equal(shown, 0);
  const ordinary = smokeVerdict({ smoke: false, log: () => {} });
  assert.equal(await ordinary.asking(box)({ title: "t", message: "m", detail: "d", buttons: ["Keep going", "Restart"] }), "restart");
  assert.equal(shown, 1);
});
