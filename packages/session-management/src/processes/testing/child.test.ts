import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { readProcess } from '../process/index.js';
import { testChildArgs } from './child.js';

// A runner killed before its teardown (a signal, a dropped SSH session) cannot stop a detached child:
// the child must notice for itself that the test that launched it is gone.
test('a test child exits by itself once the process it belongs to is gone', async t => {
  const parent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(parent, 'spawn');
  const child = spawn(process.execPath, testChildArgs(parent.pid), { stdio: 'ignore', detached: true });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  assert.equal((await readProcess(child.pid!)).state, 'live');
  parent.kill('SIGKILL');
  await once(parent, 'exit');
  const ended = await Promise.race([exited.then(() => true), pause(5_000, false, { ref: false })]);
  assert.equal(ended, true, 'the child outlived its parent by five seconds');
});
