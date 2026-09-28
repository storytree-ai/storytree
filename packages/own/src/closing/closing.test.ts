import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { localMachine, type RunOwner, type RunRecord } from '../index.js';
import * as closing from './index.js';

const owner: RunOwner = { session: 'closing-session', harness: 'codex' };
async function ledger(t: { after(fn: () => Promise<void>): void }) {
  const home = await mkdtemp(path.join(tmpdir(), 'own-closing-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, 'runs'));
  return home;
}
function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return { version: 1, id: randomUUID(), owner, machine: localMachine(), command: 'node',
    args: ['server.mjs'], folder: process.cwd(), startedAt: '2020-01-01T00:00:00.000Z',
    pid: 12345, birth: { state: 'gone' }, ...overrides };
}
async function save(home: string, ...runs: RunRecord[]) {
  for (const run of runs) await writeFile(path.join(home, 'runs', `${run.id}.json`), JSON.stringify(run));
}
const uncertain = { state: 'unknown', reason: 'native birth identity unavailable' } as const;

test('5.1: clear removes only caller records whose original lifetime and registered descendants are gone', async t => {
  const home = await ledger(t);
  const gone = record();
  const parent = record();
  const child = record({ parentRun: parent.id });
  const grandchild = record({ parentRun: child.id, birth: uncertain,
    owner: { session: 'delegated-child', harness: 'codex', parentSession: owner.session } });
  const other = record({ owner: { session: 'other', harness: 'codex' } });
  const otherHarness = record({ owner: { ...owner, harness: 'claude-code' } });
  await save(home, gone, parent, child, grandchild, other, otherHarness);
  const result = await closing.clearOwned({ home, owner });
  assert.deepEqual(result.removed, [gone.id]);
  assert.deepEqual(new Set(result.retained.map(row => row.run)), new Set([parent.id, child.id]));
  assert.ok(result.retained.every(row => row.blockedBy.includes(grandchild.id)));
  assert.deepEqual(new Set(await readdir(path.join(home, 'runs'))),
    new Set([parent, child, grandchild, other, otherHarness].map(run => `${run.id}.json`)));
  await save(home, { ...grandchild, birth: { state: 'gone' } });
  const finished = await closing.clearOwned({ home, owner });
  assert.deepEqual(new Set(finished.removed), new Set([parent.id, child.id]));
  assert.deepEqual(new Set(await readdir(path.join(home, 'runs'))),
    new Set([grandchild, other, otherHarness].map(run => `${run.id}.json`)));
});

test('5.2: live, unknown and foreign records remain; a named subagent cannot clear its siblings', async t => {
  const home = await ledger(t);
  const live = record({ birth: { state: 'live', identity: {
    pid: 12345, platform: process.platform, boot: 'boot', started: 'original-lifetime',
  } } });
  const unknown = record({ birth: uncertain });
  const foreign = record({ machine: 'another-computer' });
  const ownAgent = record({ owner: { ...owner, agent: { subagent: 'one' } } });
  const sibling = record({ owner: { ...owner, agent: { subagent: 'two' } } });
  await save(home, live, unknown, foreign, ownAgent, sibling);
  const agent = await closing.clearOwned({ home, owner: ownAgent.owner });
  assert.deepEqual(agent.removed, [ownAgent.id]);
  const result = await closing.clearOwned({ home, owner, probe: async identity => ({ state: 'live', identity }) });
  assert.deepEqual(result.removed, [sibling.id]);
  assert.deepEqual(new Set(result.retained.map(row => row.run)), new Set([live.id, unknown.id, foreign.id]));
  await assert.rejects(closing.clearOwned({ home, owner: { session: ' ' } }), /session|String|small/i);
});

test('5.2/5.4: unreadable records and known registration gaps survive clear and prevent unproved child clearance', async t => {
  const home = await ledger(t);
  const gone = record();
  await save(home, gone);
  const broken = path.join(home, 'runs', 'broken.json');
  await writeFile(broken, '{');
  await mkdir(path.join(home, 'gaps'));
  const gapFile = path.join(home, 'gaps', `${randomUUID()}.json`);
  const gap = JSON.stringify({ kind: 'registration', reason: 'child launch record could not be saved', pid: 23456 });
  await writeFile(gapFile, gap);
  const result = await closing.clearOwned({ home, owner });
  assert.deepEqual(result.removed, []);
  assert.equal(result.retained[0]?.run, gone.id);
  assert.ok(result.gaps.some(row => row.path === broken));
  assert.ok(result.gaps.some(row => row.kind === 'registration'));
  assert.equal(await readFile(broken, 'utf8'), '{');
  assert.equal(await readFile(gapFile, 'utf8'), gap);
});

test('5.2: failed removals are reported and never counted as cleared', async t => {
  const home = await ledger(t);
  const gone = record();
  await save(home, gone);
  const result = await closing.clearOwned({ home, owner }, { remove: async file => {
    assert.equal(file, path.join(home, 'runs', `${gone.id}.json`));
    throw new Error('permission denied removing record');
  } });
  assert.deepEqual(result.removed, []);
  assert.equal(result.failed[0]?.run, gone.id);
  assert.match(result.failed[0]?.reason ?? '', /permission denied/);
  assert.equal(JSON.parse(await readFile(path.join(home, 'runs', `${gone.id}.json`), 'utf8')).id, gone.id);
});

test('5.1/5.2: clear rereads ownership and child membership after probing, before removing a record', async t => {
  const home = await ledger(t);
  const root = record({ birth: { state: 'live', identity: {
    pid: 12345, platform: process.platform, boot: 'boot', started: 'original-lifetime',
  } } });
  const lateChild = record({ parentRun: root.id, birth: uncertain });
  await save(home, root);
  const late = await closing.clearOwned({ home, owner, probe: async () => {
    await save(home, lateChild);
    return { state: 'gone' };
  } });
  assert.deepEqual(late.removed, []);
  assert.ok(late.retained.find(row => row.run === root.id)?.blockedBy.includes(lateChild.id));
  await rm(path.join(home, 'runs', `${lateChild.id}.json`));
  const changed = await closing.clearOwned({ home, owner, probe: async () => {
    await save(home, { ...root, owner: { session: 'other', harness: 'codex' } });
    return { state: 'gone' };
  } });
  assert.deepEqual(changed.removed, []);
  assert.match(changed.retained[0]?.reason ?? '', /changed|owner/i);
});

test('5.3: the closing reading still names live and unknown work belonging to old and other sessions', async t => {
  const home = await ledger(t);
  const live = record({ owner: { session: 'ended-session', harness: 'claude-code' },
    birth: { state: 'live', identity: { pid: 12345, platform: process.platform, boot: 'boot', started: 'start' } } });
  const unknown = record({ owner: { session: 'released-claims', harness: 'codex' }, birth: uncertain });
  await save(home, live, unknown);
  const reading = await closing.readClosing({ home, owner, probe: async identity => ({ state: 'live', identity }) });
  assert.equal(reading.status, 'incomplete');
  assert.deepEqual(new Set(reading.inventory.rows.map(row => row.run.id)), new Set([live.id, unknown.id]));
  const rendered = closing.renderClosing(reading);
  assert.match(rendered, /ended-session/);
  assert.match(rendered, /released-claims/);
  assert.match(rendered, /LIVE/);
  assert.match(rendered, /UNKNOWN/);
  assert.doesNotMatch(rendered, /no tracked session work remains/i);
  await rm(path.join(home, 'runs', `${unknown.id}.json`));
  assert.equal((await closing.readClosing({ home, probe: async identity => ({ state: 'live', identity }) })).status, 'remaining');
});

test('5.4: empty observations with persisted, unreadable or caller-carried missing evidence are incomplete', async t => {
  const home = await ledger(t);
  const gap = { kind: 'registration', reason: 'launch succeeded but registration and gap persistence failed', pid: 23456 } as const;
  const carried = await closing.readClosing({ home, knownGaps: [gap] });
  assert.equal(carried.status, 'incomplete');
  assert.equal(carried.inventory.complete, false);
  assert.deepEqual(carried.inventory.gaps, [gap]);
  assert.match(closing.renderClosing(carried), /Gap \(registration\).*registration and gap persistence failed/);
  assert.doesNotMatch(closing.renderClosing(carried), /no tracked session work remains/i);
  const gone = record();
  await save(home, gone);
  assert.deepEqual((await closing.clearOwned({ home, owner, knownGaps: [gap] })).removed, []);
  await mkdir(path.join(home, 'gaps'));
  await writeFile(path.join(home, 'gaps', `${randomUUID()}.json`), JSON.stringify(gap));
  await writeFile(path.join(home, 'runs', 'broken.json'), '{');
  const persisted = await closing.readClosing({ home });
  assert.equal(persisted.status, 'incomplete');
  assert.equal(persisted.inventory.gaps.length, 2);
  assert.match(closing.renderClosing(persisted), /broken.json/);
});

test('5.5: an empty or confirmed-gone inventory has bounded local coverage and leaves shared work alone', async t => {
  const home = await ledger(t);
  const empty = await closing.readClosing({ home });
  assert.equal(empty.status, 'empty');
  assert.match(closing.renderClosing(empty), /no tracked session work remains on this machine/);
  assert.match(closing.renderClosing(empty), /not a whole-machine census/);
  const gone = record();
  await save(home, gone);
  const reading = await closing.readClosing({ home,
    shared: [{ name: 'database', state: 'live', reason: 'managed by the app' }],
  });
  assert.equal(reading.status, 'empty');
  assert.match(closing.renderClosing(reading), /Shared.*database.*live/);
  assert.match(closing.renderClosing(reading), /remote.*not|not.*remote/i);
  assert.equal((await readdir(path.join(home, 'runs'))).length, 1, 'reading never clears records');
});
