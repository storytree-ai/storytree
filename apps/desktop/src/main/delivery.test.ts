import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { removeTemp } from "@storytree/test-waits";

test("app setup 1.1 / library 14.5: delivered tools run outside a checkout, including native embedding inference without a model download", async (t) => {
  const temp = mkdtempSync(path.join(tmpdir(), "storytree delivered tools "));
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const started = performance.now();
  const observe = (message: string) => console.log(`delivery +${Math.round(performance.now() - started)} ms: ${message}`);
  // A test timeout does not await its body's finally block; an after hook still gets to finish.
  t.after(async () => {
    observe('cleanup START');
    await removeTemp(temp);
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
      await phase('build bundle and stage native runtime', () => buildToolBundle(dir));
      await phase('check native inference, commands and MCP', () => checkTools(process.execPath, dir, path.join(temp, 'fresh user')));
      console.log('standalone tools PASS');
    `], { cwd, env: { ...process.env, STORYTREE_DELIVERY_TEST_DIR: temp }, encoding: "utf8", timeout: 60_000, signal: t.signal });
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
