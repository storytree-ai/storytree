import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('4.17 · showing hidden roads draws them by distance, preserves recorded arrivals, and respects reduced motion', { timeout: 150_000 }, async () => {
  await promisify(execFile)(process.execPath, ['--import', 'tsx', 'packages/forest-world/testing/globe-exterior/reveal.mjs', '--smoke'], {
    cwd: fileURLToPath(new URL('../../../..', import.meta.url)), timeout: 140_000,
    env: { ...process.env, CAPTURE_CHANNEL: process.env.CAPTURE_CHANNEL ?? 'chrome' },
  });
});
