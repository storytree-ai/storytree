import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launchOwned, localMachine, readProcess, type RunOwner, type RunRecord } from '../index.js';
import * as listing from './index.js';
import { stopOwned } from '../stopping/index.js';

const owner: RunOwner = { session: 'parent', harness: 'codex' };
const now = new Date('2026-09-28T01:00:00.000Z');
let nextPid = 12345;
async function ledger(t: { after(fn: () => Promise<void>): void }) {
  const home = await mkdtemp(path.join(tmpdir(), 'own-listing-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, 'runs'));
  return home;
}
function record(overrides: Partial<RunRecord> = {}): RunRecord {
  const pid = nextPid++;
  return { version: 1, id: randomUUID(), owner, machine: localMachine(), command: 'node',
    args: ['server with spaces.mjs'], folder: process.cwd(), startedAt: '2026-09-28T00:00:00.000Z',
    pid, birth: { state: 'live', identity: { pid, platform: process.platform, boot: 'boot', started: 'start' } }, ...overrides };
}
async function save(home: string, ...runs: RunRecord[]) {
  for (const run of runs) await writeFile(path.join(home, 'runs', `${run.id}.json`), JSON.stringify(run));
}

test('3.1/3.3: self inventory keeps lifetime, request and owner findings separate and excludes only this inspector lifetime', async t => {
  const home = await ledger(t);
  const inspecting = await readProcess(process.pid);
  assert.equal(inspecting.state, 'live');
  const inspector = record({ pid: process.pid, birth: inspecting });
  const live = record();
  const unknown = record({ birth: { state: 'unknown', reason: 'launch identity unavailable' } });
  const gone = record({ birth: { state: 'gone' } });
  const sibling = record({ owner: { session: 'sibling', harness: 'codex' } });
  const child = record({ owner: { session: 'child', harness: 'codex', parentSession: owner.session }, parentRun: live.id });
  const reused = record({ pid: process.pid, birth: { state: 'gone' } });
  await save(home, inspector, live, unknown, gone, sibling, child, reused);
  const result = await listing.listRuns({ home, owner, now, probe: async identity => ({ state: 'live', identity }) });
  assert.deepEqual(new Set(result.rows.map(row => row.run.id)), new Set([live.id, unknown.id, gone.id, child.id, reused.id]));
  const byId = new Map(result.rows.map(row => [row.run.id, row]));
  assert.equal(byId.get(live.id)?.process.state, 'live');
  assert.equal(byId.get(live.id)?.ageMs, 3_600_000);
  assert.equal(byId.get(live.id)?.request.state, 'unknown');
  assert.deepEqual(byId.get(live.id)?.run.args, ['server with spaces.mjs']);
  assert.equal(byId.get(unknown.id)?.process.state, 'unknown');
  assert.equal(byId.get(gone.id)?.endedWithoutReport, true);
  assert.equal(byId.get(child.id)?.ownership, 'descendant');
  assert.equal(result.complete, false);
  assert.match(listing.renderInventory(result), /ended without reporting|launch identity unavailable/);
  await assert.rejects(listing.listRuns({ home }), /session identity.*--all/s);
  await assert.rejects(listing.listRuns({ home, owner: { session: ' ' } }), /session identity/);
});

test('3.5/4.1: every offered stop uses stopping authority, including named siblings and conflicting registrations', async t => {
  const home = await ledger(t);
  const own = record({ owner: { ...owner, agent: { subagent: 'builder' } } });
  const sibling = record({ owner: { ...owner, agent: { subagent: 'reviewer' } } });
  const parent = record();
  const delegated = record({ owner: { session: 'delegated', harness: 'codex', parentSession: owner.session } });
  const grandchild = record({ owner: { session: 'grandchild', harness: 'codex', parentSession: 'delegated' } });
  const conflict = record();
  const stranger = record({ pid: conflict.pid, birth: conflict.birth, owner: { session: 'stranger', harness: 'codex' } });
  await save(home, own, sibling, parent, delegated, grandchild, conflict, stranger);
  for (const caller of [owner, own.owner, { ...owner, agent: 'unknown' as const }]) {
    const reading = await listing.listRuns({ home, owner: caller, scope: 'all',
      probe: async identity => ({ state: 'live', identity }),
      stopAction: run => ({ command: `storytree processes stop ${run}`, tool: 'stop_own_run', arguments: { runs: [run] } }),
    });
    const stopped = await stopOwned({ home, owner: caller, targets: reading.rows.map(row => row.run.id) }, {
      probe: async () => ({ state: 'gone' }), signal: async () => { throw new Error('must not signal'); },
    });
    for (const row of reading.rows) {
      assert.equal(row.stop.available, stopped.targets.find(target => target.target === row.run.id)?.status !== 'refused',
        `${JSON.stringify(caller)} offered ${row.run.id} outside stopping authority`);
    }
    if (caller.agent === 'unknown') {
      await assert.rejects(listing.listRuns({ home, owner: caller }), /identity.*--all/s);
      continue;
    }
    const self = await listing.listRuns({ home, owner: caller });
    if (typeof caller.agent === 'object') assert.deepEqual(self.rows.map(row => row.run.id), [own.id]);
  }
});

test('3.2/3.4: all-session inventory needs no caller and retains readable siblings, foreign records and read gaps offline', async t => {
  const home = await ledger(t);
  const first = record();
  const second = record({ owner: { session: 'other', harness: 'claude-code' } });
  const foreign = record({ machine: 'another-computer' });
  await save(home, first, second, foreign);
  await writeFile(path.join(home, 'runs', 'broken.json'), '{');
  const result = await listing.listRuns({ home, scope: 'all', now, probe: async identity => ({ state: 'live', identity }) });
  assert.equal(result.rows.length, 3);
  assert.equal(result.machine, localMachine());
  assert.equal(result.rows.find(row => row.run.id === foreign.id)?.process.state, 'unknown');
  assert.ok(result.gaps.some(gap => gap.path?.endsWith('broken.json')));
  assert.equal(result.complete, false);
  assert.ok(result.rows.every(row => !row.stop.available));
  const rendered = listing.renderInventory(result);
  assert.match(rendered, /other/);
  assert.match(rendered, /another-computer/);
  assert.match(rendered, /untracked/);
  assert.match(rendered, /incomplete/i);
  assert.match(rendered, /broken.json/);
});

test('3.5: only caller-owned live identities can offer a supplied stop action; shared and uncertain rows explain refusal', async t => {
  const home = await ledger(t);
  const live = record();
  const uncertain = record({ birth: { state: 'unknown', reason: 'access denied' } });
  const sibling = record({ owner: { session: 'sibling', harness: 'codex' } });
  await save(home, live, uncertain, sibling);
  const action = { command: `storytree processes stop ${live.id}`, tool: 'stop_runs', arguments: { runs: [live.id] } };
  const result = await listing.listRuns({ home, owner, scope: 'all', now,
    probe: async identity => ({ state: 'live', identity }),
    stopAction: run => ({ command: `storytree processes stop ${run}`, tool: 'stop_runs', arguments: { runs: [run] } }),
    shared: [{ name: 'storytree app and database', state: 'live', reason: 'Managed by the app; use storytree app quit.' }],
  });
  assert.deepEqual(result.rows.find(row => row.run.id === live.id)?.stop, { available: true, ...action });
  assert.match(result.rows.find(row => row.run.id === uncertain.id)?.stop.reason ?? '', /identity|access denied/);
  assert.match(result.rows.find(row => row.run.id === sibling.id)?.stop.reason ?? '', /another session/);
  assert.equal(result.shared[0]?.stop.available, false);
  assert.match(listing.renderInventory(result), /storytree app quit/);
  const withoutStop = await listing.listRuns({ home, owner, now, probe: async identity => ({ state: 'live', identity }) });
  assert.equal(withoutStop.rows.find(row => row.run.id === live.id)?.stop.available, false);
  assert.match(withoutStop.rows.find(row => row.run.id === live.id)?.stop.reason ?? '', /not available/);
});

test('3.1/3.4: ended requests are not missing reports, and empty coverage never claims this computer is idle', async t => {
  const home = await ledger(t);
  let result = await listing.listRuns({ home, owner, now });
  assert.equal(result.complete, true);
  assert.match(listing.renderInventory(result), /No recorded runs/);
  assert.match(result.coverage, /not a whole-machine census/);
  const run = record({ birth: { state: 'gone' } });
  await save(home, run);
  await mkdir(path.join(home, 'requests'));
  await writeFile(path.join(home, 'requests', `${randomUUID()}.json`), JSON.stringify({
    run: run.id, state: 'completed', at: now.toISOString(), evidence: 'caller received completion',
  }));
  result = await listing.listRuns({ home, owner, now });
  assert.equal(result.rows[0]?.endedWithoutReport, false);
  assert.equal(result.rows[0]?.request.state, 'completed');
  assert.equal(result.complete, true);
});


test('3.1: the inventory observes a real owned process live and then gone through the native probe', async t => {
  const home = await ledger(t);
  const launched = await launchOwned({ home, owner, command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 30000)'], folder: process.cwd() });
  if (launched.pid !== undefined) t.after(() => {
    try { process.kill(launched.pid!, 'SIGKILL'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  });
  assert.equal(launched.status, 'tracked');
  if (launched.status !== 'tracked') throw new Error('launch was not tracked');
  let inventory = await listing.listRuns({ home, owner });
  assert.equal(inventory.rows[0]?.process.state, 'live');
  assert.equal(inventory.rows[0]?.run.id, launched.run.id);
  assert.equal(inventory.complete, true);
  process.kill(launched.pid, 'SIGKILL');
  for (let attempt = 0; attempt < 200; attempt++) {
    inventory = await listing.listRuns({ home, owner });
    if (inventory.rows[0]?.process.state === 'gone') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(inventory.rows[0]?.process.state, 'gone');
  assert.equal(inventory.rows[0]?.endedWithoutReport, true);
});

test('the shared app row advises only commands the app family has', () => {
  for (const running of [true, false]) {
    const row = listing.appDatabaseWork(running);
    assert.equal(row.state, 'unknown');
    assert.match(row.reason, running ? /database running/ : /database not running/);
    assert.match(row.reason, /storytree app quit/);
    assert.doesNotMatch(row.reason, /storytree app status/);
  }
});
