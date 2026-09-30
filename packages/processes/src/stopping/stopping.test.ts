import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { launchOwned, probeProcess, readLedger, readProcess } from '../index.js';
import type { ProcessIdentity, ProcessReading, RunOwner, RunRecord } from '../index.js';
import { localMachine, writeRecord } from '../ledger/files.js';
import * as stopping from './index.js';

const owner: RunOwner = { session: 'parent', harness: 'codex', agent: 'orchestrator' };
const bounds = { graceMs: 0, forceMs: 0 };
async function home(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'own-stop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function record(home: string, fields: Partial<RunRecord> = {}): Promise<RunRecord> {
  const pid = fields.pid ?? 4242;
  const run: RunRecord = { version: 1, id: randomUUID(), owner, machine: localMachine(), pid,
    birth: { state: 'live', identity: { pid, platform: process.platform, boot: 'test-boot', started: 'test-birth' } },
    command: 'test-process', args: [], folder: home, startedAt: new Date().toISOString(), ...fields };
  await writeRecord(path.join(home, 'runs', `${run.id}.json`), run);
  return run;
}
const live = async (identity: ProcessIdentity): Promise<ProcessReading> => ({ state: 'live', identity });

test('4.1/4.6 every explicit target gets a refusal with its owner; malformed and unknown targets receive no signal', async t => {
  const dir = await home(t);
  const foreign = await record(dir, { owner: { session: 'other-session', harness: 'codex' } });
  const corrupt = randomUUID();
  await writeFile(path.join(dir, 'runs', `${corrupt}.json`), '{broken');
  const targets = [foreign.id, '../../runs', randomUUID(), corrupt];
  const result = await stopping.stopOwned({ home: dir, owner, targets, ...bounds }, {
    probe: live, signal: async () => { assert.fail('a refused target must not be signalled'); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.targets.map(row => row.target), targets);
  assert.ok(result.targets.every(row => row.status === 'refused'));
  assert.deepEqual(result.targets[0]?.owner, foreign.owner);
});

test('4.2 gone, reused, foreign-machine and uncertain lifetimes never authorize a signal', async t => {
  const dir = await home(t);
  const gone = await record(dir, { birth: { state: 'gone' } });
  const reused = await record(dir, { pid: 4243 });
  const unknown = await record(dir, { pid: 4244, birth: { state: 'unknown', reason: 'no birth identity' } });
  const remote = await record(dir, { pid: 4245, machine: 'another-computer' });
  const result = await stopping.stopOwned({ home: dir, owner, targets: [gone.id, reused.id, unknown.id, remote.id], ...bounds }, {
    probe: async () => ({ state: 'gone' }), signal: async () => { assert.fail('no lifetime authorizes a signal'); },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.targets.map(row => row.status), ['already-gone', 'already-gone', 'incomplete', 'refused']);
  assert.equal((await readLedger({ home: dir })).runs.length, 4);
});

test('4.1/4.3 parent delegation covers linked descendants, but excludes conflicting owners and never grants a subagent its siblings', async t => {
  const dir = await home(t);
  const parent = await record(dir);
  const child = await record(dir, { pid: 4243, parentRun: parent.id,
    owner: { session: 'child', harness: 'codex', parentSession: 'parent' } });
  const grandchild = await record(dir, { pid: 4244, parentRun: child.id,
    owner: { session: 'grandchild', harness: 'codex', parentSession: 'child' } });
  const foreign = await record(dir, { pid: 4245, parentRun: parent.id, owner: { session: 'other', harness: 'codex' } });
  const signalled: number[] = [];
  const result = await stopping.stopOwned({ home: dir, owner, targets: [parent.id], ...bounds }, {
    probe: async identity => signalled.includes(identity.pid) ? { state: 'gone' } : live(identity),
    signal: async identity => { signalled.push(identity.pid); return { status: 'sent' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.targets[0]?.status, 'incomplete');
  assert.deepEqual(new Set(signalled), new Set([parent.pid, child.pid, grandchild.pid]));
  assert.deepEqual(result.targets[0]?.excluded.map(row => row.run), [foreign.id]);
  assert.equal(result.targets[0]?.members.length, 3);
  assert.match(result.coverage, /registered|tracked/);

  const worker = { session: 'parent', harness: 'codex', agent: { subagent: 'one' } };
  const sibling = await record(dir, { pid: 4246, owner: { ...worker, agent: { subagent: 'two' } } });
  const refused = await stopping.stopOwned({ home: dir, owner: worker, targets: [parent.id, sibling.id, child.id], ...bounds }, {
    signal: async () => { assert.fail('subagent cannot stop its parent, sibling or a session delegated to its parent'); },
  });
  assert.ok(refused.targets.every(row => row.status === 'refused'));
});

test('4.3 a conflicting registration for the same process lifetime prevents signalling it', async t => {
  const dir = await home(t);
  const run = await record(dir);
  await record(dir, { owner: { session: 'other' }, birth: run.birth, pid: run.pid });
  const result = await stopping.stopOwned({ home: dir, owner, targets: [run.id], ...bounds }, {
    probe: live, signal: async () => { assert.fail('conflicting ownership cannot authorize a signal'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.targets[0]?.status, 'refused');
});

test('4.4/4.5 root exit cannot hide a surviving child; both phases are verified and unsuccessful records remain', async t => {
  const dir = await home(t);
  const root = await record(dir);
  const child = await record(dir, { pid: 4243, parentRun: root.id });
  const sent: { pid: number; phase: string }[] = [];
  const result = await stopping.stopOwned({ home: dir, owner, targets: [root.id], ...bounds }, {
    probe: async identity => identity.pid === root.pid && sent.length ? { state: 'gone' } : live(identity),
    signal: async (identity, phase) => { sent.push({ pid: identity.pid, phase }); return { status: 'sent' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.targets[0]?.status, 'incomplete');
  const survivor = result.targets[0]?.members.find(member => member.run === child.id);
  assert.equal(survivor?.process.state, 'live');
  assert.deepEqual(survivor?.attempts.map(attempt => attempt.phase), ['polite', 'force']);
  assert.ok(sent.some(row => row.pid === root.pid && row.phase === 'polite'));
  assert.ok(!sent.some(row => row.pid === root.pid && row.phase === 'force'));
  assert.equal((await readLedger({ home: dir })).runs.length, 2);
});

test('4.4/4.5 probe failure after delivery prevents forced signalling and a stopped verdict', async t => {
  const dir = await home(t);
  const run = await record(dir);
  let sent = 0;
  const result = await stopping.stopOwned({ home: dir, owner, targets: [run.id], ...bounds }, {
    probe: async identity => { if (sent) throw new Error('access denied'); return live(identity); },
    signal: async () => { sent++; return { status: 'sent' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(sent, 1);
  assert.equal(result.targets[0]?.members[0]?.process.state, 'unknown');
  assert.equal((await readLedger({ home: dir })).runs.length, 1);
});

test('4.3/4.6 late registrations and unreadable inventory stay explicit; a mixed batch cannot report success', async t => {
  const dir = await home(t);
  const root = await record(dir);
  let sent = false;
  const result = await stopping.stopOwned({ home: dir, owner, targets: [root.id, randomUUID()], ...bounds }, {
    probe: async identity => sent ? { state: 'gone' } : live(identity),
    signal: async () => {
      sent = true;
      await record(dir, { pid: 4243, parentRun: root.id });
      return { status: 'sent' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.targets[0]?.status, 'incomplete');
  assert.match(result.targets[0]?.excluded[0]?.reason ?? '', /during|after|new/);
  await writeFile(path.join(dir, 'runs', 'unreadable.json'), '{broken');
  const incomplete = await stopping.stopOwned({ home: dir, owner, targets: [root.id], ...bounds }, {
    probe: async () => ({ state: 'gone' }),
  });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.gaps.length > 0);
});

async function launch(t: { after(fn: () => Promise<void>): void }, dir: string, fields: Partial<Parameters<typeof launchOwned>[0]> = {}, setup = "process.on('SIGTERM', () => {});") {
  const ready = path.join(dir, `${randomUUID()}.ready`);
  const result = await launchOwned({ home: dir, owner, command: process.execPath, folder: process.cwd(),
    args: ['-e', `${setup} require('fs').writeFileSync(process.argv[1], 'ready'); setTimeout(() => {}, 30000)`, ready], ...fields });
  if (result.pid !== undefined) t.after(async () => {
    if (result.status === 'tracked' && result.run.birth.state === 'live' && (await probeProcess(result.run.birth.identity)).state === 'live') {
      try { process.kill(result.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  });
  assert.equal(result.status, 'tracked', JSON.stringify(result));
  if (result.status !== 'tracked') throw new Error('untracked fixture');
  for (let i = 0; ; i++) {
    if (await readFile(ready, 'utf8').catch(() => '') === 'ready') break;
    assert.ok(i < 400, 'child must install its signal handler');
    await pause(25);
  }
  return result.run;
}

test('4.2/4.4 native: stale identity leaves the actual process alive; registered detached child is force-stopped even after root exits', async t => {
  const dir = await home(t);
  const root = await launch(t, dir);
  const child = await launch(t, dir, { parentRun: root.id, owner: { session: 'child', harness: 'codex', parentSession: 'parent' } });
  assert.equal(root.birth.state, 'live');
  if (root.birth.state !== 'live') return;
  const stale = { ...root, birth: { state: 'live', identity: { ...root.birth.identity, started: 'different-lifetime' } } };
  await writeFile(path.join(dir, 'runs', `${root.id}.json`), JSON.stringify(stale));
  // Name the child separately later, so this stale-root check must not stop its real descendant.
  await writeFile(path.join(dir, 'runs', `${child.id}.json`), JSON.stringify({ ...child, parentRun: undefined }));
  const reused = await stopping.stopOwned({ home: dir, owner, targets: [root.id], graceMs: 50, forceMs: 2000 });
  assert.equal(reused.ok, true, JSON.stringify(reused));
  assert.equal((await readProcess(root.pid)).state, 'live');
  await writeFile(path.join(dir, 'runs', `${root.id}.json`), JSON.stringify(root));
  process.kill(root.pid, 'SIGKILL');
  for (let i = 0; (await probeProcess(root.birth.identity)).state !== 'gone'; i++) { assert.ok(i < 200); await pause(20); }
  await writeFile(path.join(dir, 'runs', `${child.id}.json`), JSON.stringify(child));
  const result = await stopping.stopOwned({ home: dir, owner, targets: [root.id], graceMs: 75, forceMs: 2000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.targets[0]?.status, 'stopped');
  assert.equal(result.targets[0]?.members.length, 2);
  assert.ok(result.targets[0]?.members.every(member => member.process.state === 'gone'));
  assert.deepEqual(result.targets[0]?.members.find(member => member.run === child.id)?.attempts.map(attempt => attempt.phase), ['polite', 'force']);
  assert.equal((await readLedger({ home: dir })).runs.length, 2);
});


test('4.4 native: a cooperative process exits in the polite phase, while another owner stays live', async t => {
  const dir = await home(t);
  // A hidden top-level native window exercises actual WM_CLOSE delivery on Windows CI.
  // Other systems install a normal SIGTERM handler before publishing readiness.
  const setup = process.platform !== 'win32' ? "process.on('SIGTERM', () => process.exit(0));" : `
    const k = require('koffi');
    const u = k.load('user32.dll');
    const create = u.func('void * __stdcall CreateWindowExW(uint32_t ex, const char16_t *klass, const char16_t *title, uint32_t style, int x, int y, int w, int h, void *parent, void *menu, void *instance, void *param)');
    const peek = u.func('int __stdcall PeekMessageW(void *message, void *window, uint32_t first, uint32_t last, uint32_t remove)');
    const dispatch = u.func('intptr_t __stdcall DispatchMessageW(const void *message)');
    const isWindow = u.func('int __stdcall IsWindow(void *window)');
    const window = create(0, 'STATIC', 'own stop polite test', 0, 0, 0, 1, 1, null, null, null, null);
    if (!window) throw new Error('test window could not be created');
    setInterval(() => {
      const message = Buffer.alloc(48);
      while (peek(message, null, 0, 0, 1)) dispatch(message);
      if (!isWindow(window)) process.exit(0);
    }, 10);
  `;
  const run = await launch(t, dir, { folder: path.resolve(import.meta.dirname, '../..') }, setup);
  const foreign = await launch(t, dir, { owner: { session: 'other-session', harness: 'codex' } });
  const result = await stopping.stopOwned({ home: dir, owner, targets: [run.id], graceMs: 2000, forceMs: 2000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.targets[0]?.members[0]?.attempts.map(attempt => attempt.phase), ['polite']);
  assert.equal((await readProcess(foreign.pid)).state, 'live');
});

test('4.3 a conflicting registration appearing between deliveries prevents the next child signal', async t => {
  const dir = await home(t);
  const root = await record(dir);
  const child = await record(dir, { pid: 4243, parentRun: root.id });
  const sent: number[] = [];
  const result = await stopping.stopOwned({ home: dir, owner, targets: [root.id], ...bounds }, {
    probe: async identity => sent.includes(identity.pid) ? { state: 'gone' } : live(identity),
    signal: async identity => {
      sent.push(identity.pid);
      if (identity.pid === root.pid) await record(dir, { pid: child.pid, birth: child.birth, owner: { session: 'new-conflicting-owner' } });
      return { status: 'sent' };
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(sent, [root.pid]);
  assert.ok(result.targets[0]?.excluded.some(row => row.run === child.id));
});
