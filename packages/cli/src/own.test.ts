import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launchOwned } from '@storytree/own';
import { BuiltCommand, storytree } from './testing/cli.js';

test('own 3.4/3.6/4.1: the built CLI inventories and stops offline, with each outcome and no cross-session authority', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'own-door-'));
  const command = new BuiltCommand();
  t.after(async () => { command.remove(); await rm(home, { recursive: true, force: true }); });
  await command.build();
  const runs = [];
  for (const session of ['caller', 'other']) {
    const launched = await launchOwned({ home: path.join(home, 'own'), owner: { session, harness: 'codex' },
      command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], folder: home });
    if (launched.pid) t.after(() => { try { process.kill(launched.pid!, 'SIGKILL'); } catch {} });
    assert.equal(launched.status, 'tracked');
    if (launched.status !== 'tracked') throw new Error('untracked test child');
    runs.push(launched.run);
  }
  const invoke = (args: string[], identified = true) => storytree(command.script, ['own', ...args], {
    cwd: home, home, env: { CODEX_THREAD_ID: identified ? 'caller' : '' },
  });
  const all = await invoke(['--all'], false);
  assert.equal(all.code, 0, all.stderr);
  for (const run of runs) assert.ok(all.stdout.includes(run.id), all.stdout);
  assert.match(all.stdout, /LIVE/);
  assert.match(all.stdout, /no.*stop authority/i);
  assert.match(all.stdout, /untracked/);
  const missing = await invoke([], false);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /session identity.*--all/s);
  const self = await invoke([]);
  assert.equal(self.code, 0, self.stderr);
  assert.ok(self.stdout.includes(`storytree own stop ${runs[0]!.id}`));
  assert.ok(!self.stdout.includes(runs[1]!.id));
  const stopped = await invoke(['stop', ...runs.map(run => run.id)]);
  assert.equal(stopped.code, 1, stopped.stdout + stopped.stderr);
  const result = JSON.parse(stopped.stderr);
  assert.deepEqual(result.targets.map((target: { status: string }) => target.status), ['stopped', 'refused']);
  const gone = await invoke(['stop', runs[0]!.id]);
  assert.equal(gone.code, 0, gone.stderr);
  assert.equal(JSON.parse(gone.stdout).targets[0].status, 'already-gone');
  for (const args of [['clear'], ['stop'], ['--bogus'], ['stop', '--all']]) {
    assert.equal((await invoke(args)).code, 2, `invalid arguments: ${args.join(' ')}`);
  }
});
