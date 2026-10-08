import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { backUp, keepBackups } from '/repo/packages/app/src/lifecycle/backups.ts';
import { appHome } from '/repo/apps/desktop/src/home.ts';

const root = '/work/challenge-backups';
mkdirSync(root, { mode: 0o755 });
const project = 'synthetic-project';
const snapshot = { format: 'storytree-project-snapshot' as const, version: 1 as const, project,
  takenAt: '2026-10-07T00:00:00.000Z',
  records: [{ id: 'synthetic-1', type: 'synthetic', version: 1, fields: { text: 'synthetic current record' }, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }],
  history: [{ seq: 1, recordId: 'synthetic-1', type: 'synthetic', action: 'created' as const, record: { text: 'synthetic historical record' }, at: '2026-10-07T00:00:00Z' }] };
const mode = (file: string) => (statSync(file).mode & 0o777).toString(8);
const before = process.umask();
try {
  for (const mask of [0o022, 0o077]) {
    process.umask(mask);
    const syntheticHome = path.join(root, `mask-${mask.toString(8)}`);
    mkdirSync(syntheticHome, { mode: 0o755 });
    const home = appHome(syntheticHome);
    const events: string[] = [];
    const scheduled = keepBackups({ dir: home.backups, log: text => events.push(text), storytree: {
      listProjects: async () => [project], snapshot: async name => { assert.equal(name, project); return snapshot; },
    } });
    try {
      for (let i = 0; i < 10 && events.length === 0; i++) await new Promise(resolve => setImmediate(resolve));
      assert.equal(events.length, 1);
    } finally { scheduled.stop(); }
    const folder = path.join(home.backups, project);
    const files = readdirSync(folder);
    assert.equal(files.length, 1);
    const file = path.join(folder, files[0]!);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), snapshot);
    assert.equal(mode(file), mask === 0o022 ? '644' : '600');
    assert.equal(mode(folder), mask === 0o022 ? '755' : '700');
    console.log(JSON.stringify({ case: 'startup-backup', umask: mask.toString(8), appHomeMode: mode(home.dir), backupDirMode: mode(home.backups), projectDirMode: mode(folder), fileMode: mode(file), currentAndHistoricalDataPreserved: true, partialFileRemaining: files.some(name => name.endsWith('.partial')) }));
  }
  process.umask(0o022);
  const privateParent = path.join(root, 'private-parent');
  mkdirSync(privateParent, { mode: 0o700 });
  const privateDir = path.join(privateParent, 'backups');
  const [privateFile] = await backUp({ dir: privateDir, projects: [project], storytree: { snapshot: async () => snapshot }, now: new Date('2026-10-07T00:00:00Z') });
  assert.equal(mode(privateParent), '700');
  assert.equal(mode(privateFile!), '644');
  console.log(JSON.stringify({ case: 'private-ancestor-control', ancestorMode: mode(privateParent), fileMode: mode(privateFile!), otherUserTraversalBlockedByMode: true }));
  const [newFile] = await backUp({ dir: privateDir, projects: [project], storytree: { snapshot: async () => snapshot }, now: new Date('2026-10-08T00:00:00Z'), keep: 1 });
  assert.equal(existsSync(privateFile!), false);
  assert.deepEqual(JSON.parse(readFileSync(newFile!, 'utf8')), snapshot);
  assert.equal(readdirSync(path.dirname(newFile!)).length, 1);
  console.log(JSON.stringify({ case: 'bounded-retention-control', retained: 1, snapshotPreserved: true }));
} finally { process.umask(before); }
