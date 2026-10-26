/** Test waits 1.1, 2.1–2.3 and 3.1–3.2: the environment's factor, waiting for a check, and removing a test's folders (ADR-1156). */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { factor, quietFor, removeTemp, scaled, waitUntil, type Clock } from "./index.js";

/** A clock that moves only when the helper pauses, recording each pause. */
function fakeClock(): Clock & { pauses: number[] } {
  let at = 0;
  const pauses: number[] = [];
  return {
    pauses,
    now: () => at,
    sleep: async (ms) => {
      pauses.push(ms);
      at += ms;
    },
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

test("1.1 · the factor is 1 on Linux and larger on Windows and macOS", () => {
  assert.equal(factor("linux"), 1);
  assert.ok(factor("win32") > 1, "CI's Windows runners pass the same tests several times slower");
  assert.ok(factor("darwin") > 1, "macOS runners pass them slower too");
  assert.equal(scaled(1000, "linux"), 1000);
  assert.equal(scaled(1000, "win32"), 4000, "a second stated is four on Windows");
});

test("2.1 · a wait backs off and returns what the check found as soon as it holds", async () => {
  const clock = fakeClock();
  let calls = 0;
  const found = await waitUntil(() => (++calls === 5 ? "ready" : false), 5000, "the server to answer", { clock, platform: "linux" });
  assert.equal(found, "ready");
  assert.equal(calls, 5);
  assert.deepEqual(clock.pauses, [25, 50, 100, 200], "pauses start small and double");
});

test("2.1 · a wait's pauses are capped and never run past the scaled budget", async () => {
  for (const platform of ["linux", "win32"] as const) {
    const clock = fakeClock();
    await assert.rejects(waitUntil(() => false, 10_000, "nothing", { clock, platform }));
    assert.ok(Math.max(...clock.pauses) <= 1000, "each pause is capped at 1 s");
    assert.equal(sum(clock.pauses), scaled(10_000, platform), `on ${platform} the wait spends exactly its scaled budget`);
  }
});

test("2.2 · a wait that runs out fails naming what it waited for and how long", async () => {
  const clock = fakeClock();
  await assert.rejects(waitUntil(async () => false, 1500, "the child to exit", { clock, platform: "win32" }), (error: Error) => {
    assert.match(error.message, /the child to exit/);
    assert.match(error.message, /6\.0 s/, "the time it waited, scaled");
    return true;
  });
});

test("2.3 · a quiet check watches the whole scaled window", async () => {
  const clock = fakeClock();
  let calls = 0;
  await quietFor(() => (calls++, false), 1000, "a second heartbeat", { clock, platform: "win32" });
  assert.equal(sum(clock.pauses), 4000, "it observed for the whole scaled window");
  assert.ok(calls > 2, "and looked more than at its two ends");
});

test("2.3 · a quiet check fails, naming what happened, the moment it does", async () => {
  const clock = fakeClock();
  let calls = 0;
  await assert.rejects(quietFor(() => ++calls === 3, 1000, "a second heartbeat", { clock, platform: "linux" }), /a second heartbeat happened after 0\.1 s/);
  assert.equal(calls, 3, "it stopped looking once it happened");
});

/** An rm that refuses with `code` for its first `times` calls, then does nothing. */
function heldRm(times: number, code: string) {
  const calls: string[] = [];
  return {
    calls,
    rm: async (target: string) => {
      calls.push(target);
      if (calls.length <= times) throw Object.assign(new Error(`${code}: resource busy`), { code });
    },
  };
}

test("3.1 · a removal retries while the folder is held, and removes it", async () => {
  for (const code of ["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"]) {
    const clock = fakeClock();
    const held = heldRm(2, code);
    await removeTemp("/tmp/held", 10_000, { clock, platform: "linux", rm: held.rm });
    assert.equal(held.calls.length, 3, `${code} is retried until it clears`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-test-waits-"));
  mkdirSync(path.join(dir, "inner"));
  writeFileSync(path.join(dir, "inner", "file.txt"), "x");
  await removeTemp(dir);
  assert.equal(existsSync(dir), false, "a real folder and what it holds are removed");
});

test("3.1 · any other removal error is thrown at once", async () => {
  const held = heldRm(1, "ENOTDIR");
  await assert.rejects(removeTemp("/tmp/odd", 10_000, { clock: fakeClock(), rm: held.rm }), /ENOTDIR/);
  assert.equal(held.calls.length, 1);
});

test("3.2 · a folder still held past the scaled budget is left with a warning", async () => {
  const clock = fakeClock();
  const held = heldRm(Infinity, "EBUSY");
  const warnings: string[] = [];
  await removeTemp("/tmp/stuck", 2000, { clock, platform: "win32", rm: held.rm, warn: (text) => warnings.push(text) });
  assert.equal(sum(clock.pauses), 8000, "it retried for the whole scaled budget");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /\/tmp\/stuck/);
});
