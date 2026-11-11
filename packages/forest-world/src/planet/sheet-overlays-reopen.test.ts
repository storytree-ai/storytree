import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('4.35, 4.45 · in a real browser, a sheet opened, closed and opened again shows its lanes notice, and React reports no root unmounted mid-render; a host that shows the notice itself is told it and gets none laid over the sheet', { timeout: 150_000 }, async () => {
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'packages/forest-world/testing/sheet-overlays/reopen.mjs', '--smoke'], {
    cwd: fileURLToPath(new URL('../../../..', import.meta.url)), timeout: 140_000,
    env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? 'chrome' },
  });
});
