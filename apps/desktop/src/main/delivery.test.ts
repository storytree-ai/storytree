import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

test("app setup 1.1 / library 14.5: delivered tools run outside a checkout, including native embedding inference without a model download", { timeout: 300_000 }, async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), "storytree delivered tools "));
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const started = performance.now();
  const observe = (message: string) => console.log(`delivery +${Math.round(performance.now() - started)} ms: ${message}`);
  // A test timeout does not await its body's finally block; an after hook still gets to finish.
  t.after(async () => {
    observe('cleanup START');
    await removeTempDir(temp);
    observe('cleanup finished');
  });
  try {
    observe('child START');
    const pending = promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { writeSync } from 'node:fs';
      import path from 'node:path';
      const started = performance.now();
      const observe = message => writeSync(1, 'delivery child +' + Math.round(performance.now() - started) + ' ms: ' + message + '\\n');
      async function phase(name, run) {
        const started = performance.now();
        observe(name + ' START');
        try {
          const result = await run();
          observe(name + ' PASS (' + Math.round(performance.now() - started) + ' ms)');
          return result;
        } catch (error) {
          observe(name + ' FAIL (' + Math.round(performance.now() - started) + ' ms): ' + error.message);
          throw error;
        }
      }
      const [{ buildToolBundle }, { checkTools }] = await phase('load helpers', () => Promise.all([
        import('./apps/desktop/tools.mjs'), import('./apps/desktop/check-tools.mjs'),
      ]));
      const temp = process.env.STORYTREE_DELIVERY_TEST_DIR;
      const dir = path.join(temp, 'installed app', 'resources', 'agent-tools');
      for (const n of [1, 2, 3]) await phase('EXP extra build ' + n, () => buildToolBundle(path.join(temp, 'exp' + n)));
      await phase('build bundle and stage native runtime', () => buildToolBundle(dir));
      await phase('check native inference, commands and MCP', () => checkTools(process.execPath, dir, path.join(temp, 'fresh user')));
      console.log('standalone tools PASS');
    `], { cwd, env: { ...process.env, STORYTREE_DELIVERY_TEST_DIR: temp }, encoding: "utf8", timeout: 300_000, signal: t.signal });
    // Keep observations even when the child stalls: the old synchronous call printed only on
    // success, and blocked the test runner's own timeout until it returned.
    pending.child.stdout!.pipe(process.stdout, { end: false });
    pending.child.stderr!.pipe(process.stderr, { end: false });
    const result = await pending;
    observe('child exited');
    assert.match(result.stdout, /standalone tools PASS/);
    assert.match(result.stdout, /native ONNX CPU inference returned 42; no model download/);
  } catch (error) {
    observe(`child FAIL: ${(error as Error).message}`);
    throw error;
  }
});

// On Windows the folder can stay held for a moment after the child that loaded native binaries from
// it exits (EBUSY, EPERM): retry for a while, then leave it in the system's temp directory and say
// so, rather than failing the delivery this test protects. The agent link's tests do the same
// (packages/agent-link/src/testing/folders.ts).
async function removeTempDir(dir: string, waitMs = 10_000): Promise<void> {
  const deadline = Date.now() + waitMs;
  let observedHold = false;
  for (;;) {
    try {
      return await rm(dir, { recursive: true, force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(code)) throw error;
      if (!observedHold) console.log(`delivery cleanup: waiting for held files (${code})`);
      observedHold = true;
      if (Date.now() >= deadline) return console.warn(`left the test folder ${dir} behind: still held after ${waitMs} ms (${code})`);
      await pause(100);
    }
  }
}
