import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import * as own from './index.js';

const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function home(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'own-foundation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const command = { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 30000)'], folder: process.cwd() };
async function cleanup(pid: number) {
  try { process.kill(pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await own.readProcess(pid)).state === 'gone') return;
    await pause();
  }
  throw new Error(`test child ${pid} did not exit`);
}
async function launch(t: { after(fn: () => Promise<void>): void }, options: Parameters<typeof own.launchOwned>[0]) {
  const result = await own.launchOwned(options);
  if (result.pid !== undefined) t.after(() => cleanup(result.pid!));
  assert.equal(result.status, 'tracked', JSON.stringify(result));
  if (result.status !== 'tracked') throw new Error('launch was untracked');
  return result.run;
}

test('1.1/1.2/1.4: Claude, Codex and session-bound manual launches durably keep separate owners in one folder', async t => {
  const root = await home(t);
  const owners = [
    own.ownerFromCall({ caller: { session: 'same-folder-a', harness: 'claude-code' }, agent: 'orchestrator' }),
    own.ownerFromCall({ caller: { session: 'same-folder-b', harness: 'codex' }, agent: { subagent: 'worker-1' } }),
    { session: 'terminal-session', harness: 'manual' },
  ];
  const runs = [];
  for (const owner of owners) runs.push(await launch(t, { ...command, home: root, owner, project: 'forest' }));
  const persisted = await Promise.all(runs.map(run => readFile(path.join(root, 'runs', `${run.id}.json`), 'utf8').then(JSON.parse)));
  assert.deepEqual(persisted.map(run => run.owner), owners);
  assert.equal(new Set(persisted.map(run => run.id)).size, 3);
  for (const run of persisted) {
    assert.equal(run.project, 'forest');
    assert.equal(run.folder, command.folder);
    assert.equal(run.command, command.command);
    assert.deepEqual(run.args, command.args);
    assert.ok(run.machine && run.startedAt);
    assert.equal(run.birth.state, 'live');
    assert.equal(run.birth.identity.pid, run.pid);
  }
});

test('1.3/2.1/2.2: a detached launch survives its launcher and old session evidence; request timeout is explicit', async t => {
  const root = await home(t);
  const fixture = fileURLToPath(new URL('./testing/detached-launcher.ts', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', fixture, root], { cwd: command.folder });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'tracked', stdout);
  t.after(() => cleanup(result.pid));
  const recordFile = path.join(root, 'runs', `${result.run.id}.json`);
  const run = JSON.parse(await readFile(recordFile, 'utf8'));
  run.startedAt = '2000-01-01T00:00:00.000Z';
  await writeFile(recordFile, JSON.stringify(run));
  let seen = await own.observeRuns({ home: root });
  assert.equal(seen.runs[0]?.process.state, 'live');
  assert.deepEqual(seen.runs[0]?.request, { state: 'unknown' });
  await own.recordRequestOutcome({ home: root, run: run.id, owner: run.owner,
    outcome: 'timed-out', evidence: 'caller request req-17 exceeded its deadline' });
  seen = await own.observeRuns({ home: root });
  assert.equal(seen.runs[0]?.process.state, 'live');
  assert.equal(seen.runs[0]?.request.state, 'timed-out');
  assert.equal(seen.runs[0]?.run.owner.session, 'detached-owner');
  assert.equal(seen.runs[0]?.run.startedAt, '2000-01-01T00:00:00.000Z');
  await assert.rejects(own.recordRequestOutcome({ home: root, run: run.id,
    owner: { session: 'somebody-else' }, outcome: 'timed-out', evidence: 'wrong caller' }), /owner/);
});

test('1.3/2.1: explicitly linked subagent work remains owned after its parent run exits', async t => {
  const root = await home(t);
  const parent = await launch(t, { ...command, home: root, owner: { session: 'parent', harness: 'codex' } });
  const child = await launch(t, { ...command, home: root, parentRun: parent.id,
    owner: { session: 'child', harness: 'codex', parentSession: 'parent' } });
  await cleanup(parent.pid);
  const seen = await own.observeRuns({ home: root });
  assert.equal(seen.runs.find(row => row.run.id === parent.id)?.process.state, 'gone');
  const surviving = seen.runs.find(row => row.run.id === child.id)!;
  assert.equal(surviving.process.state, 'live');
  assert.equal(surviving.run.parentRun, parent.id);
  assert.equal(surviving.run.owner.parentSession, 'parent');
  const refused = await own.launchOwned({ ...command, home: root, parentRun: parent.id, owner: { session: 'unrelated' } });
  assert.equal(refused.status, 'untracked');
  assert.equal(refused.pid, undefined);
});

test('1.5: absent owner and failed registration report an untracked launch instead of guessing', async t => {
  const root = await home(t);
  const absent = await own.launchOwned({ ...command, home: root });
  assert.equal(absent.status, 'untracked');
  assert.equal(absent.pid, undefined);
  assert.match(absent.gap.reason, /owner/);
  const blocked = path.join(root, 'blocked');
  await writeFile(blocked, 'a file cannot hold a run ledger');
  const failed = await own.launchOwned({ ...command, home: blocked, owner: { session: 'actual-owner' } });
  if (failed.pid !== undefined) t.after(() => cleanup(failed.pid!));
  assert.equal(failed.status, 'untracked');
  assert.match(failed.gap.reason, /registr|ledger/);
  assert.ok((await own.readLedger({ home: root })).gaps.length > 0);
});

test('2.3/2.5: uncertainty and unreadable records remain visible beside readable siblings', async t => {
  const root = await home(t);
  const run = await launch(t, { ...command, home: root, owner: { session: 'reader' } });
  await writeFile(path.join(root, 'runs', 'broken.json'), '{unfinished');
  const seen = await own.observeRuns({ home: root, probe: async () => ({ state: 'unknown', reason: 'access denied' }) });
  assert.equal(seen.runs.length, 1);
  assert.equal(seen.runs[0]?.run.id, run.id);
  assert.equal(seen.runs[0]?.process.state, 'unknown');
  assert.ok(seen.gaps.some(gap => gap.path?.endsWith('broken.json')));
  const blocked = path.join(root, 'not-a-directory');
  await writeFile(blocked, 'blocked inventory');
  assert.ok((await own.readLedger({ home: blocked })).gaps.some(gap => /read/.test(gap.reason)));
  assert.ok((await readdir(path.join(root, 'runs'))).includes(`${run.id}.json`));
});

test('1.1/2.4: launch time precedes observation, and the spawned child exiting overrides a reused PID reading', async t => {
  const root = await home(t);
  let observedAt = 0;
  const result = await own.launchOwned({ ...command, home: root, owner: { session: 'short-lived' } }, {
    readProcess: async pid => {
      const original = await own.readProcess(pid);
      assert.equal(original.state, 'live');
      if (original.state !== 'live') throw new Error('test child has no identity');
      await cleanup(pid);
      await new Promise(resolve => setTimeout(resolve, 30));
      observedAt = Date.now();
      return { state: 'live', identity: { ...original.identity, started: 'replacement-lifetime' } };
    },
  });
  assert.equal(result.status, 'tracked');
  if (result.status !== 'tracked') return;
  assert.deepEqual(result.run.birth, { state: 'gone' });
  assert.ok(Date.parse(result.run.startedAt) < observedAt - 20);
  assert.equal((await own.observeRuns({ home: root })).runs[0]?.process.state, 'gone');
});
