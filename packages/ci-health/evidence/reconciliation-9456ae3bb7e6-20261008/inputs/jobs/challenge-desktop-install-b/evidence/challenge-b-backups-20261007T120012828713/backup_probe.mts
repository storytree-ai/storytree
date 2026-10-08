import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { backUp, keepBackups } from '/repo/packages/app/src/lifecycle/backups.ts';

const base = '/work/challenge-b-backups';
mkdirSync(base, { mode: 0o755 });
const mode = (file: string) => (statSync(file).mode & 0o777).toString(8).padStart(4, '0');
const snapshot = (project: string) => ({ format: 'storytree-project-snapshot' as const, version: 1 as const, project,
  takenAt: '2026-10-07T00:00:00.000Z',
  records: [{ id: 'synthetic-record', type: 'note', version: 1, fields: { text: 'synthetic-private-record' }, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }],
  history: [{ seq: 1, recordId: 'synthetic-record', type: 'note', action: 'created' as const, record: { text: 'synthetic-history' }, at: '2026-10-07T00:00:00Z' }],
});
const storytree = { snapshot: async (project: string) => snapshot(project) };
const originalUmask = process.umask();
try {
  for (const mask of [0o022, 0o077]) {
    process.umask(mask);
    const dir = path.join(base, `mask-${mask.toString(8)}`);
    const [file] = await backUp({ dir, projects: ['sample'], storytree, now: new Date('2026-10-07T00:00:00Z') });
    assert.ok(file);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), snapshot('sample'));
    assert.equal(mode(file), mask === 0o022 ? '0644' : '0600');
    assert.equal(mode(path.dirname(file)), mask === 0o022 ? '0755' : '0700');
    assert.deepEqual(readdirSync(path.dirname(file)), [path.basename(file)]);
    console.log(JSON.stringify({ case: 'direct-backup', umask: mask.toString(8), fileMode: mode(file), projectDirectoryMode: mode(path.dirname(file)), backupRootMode: mode(dir), exactSyntheticSnapshotPreserved: true, partialFileAbsent: true }));
  }
  process.umask(0o022);
  const privateHome = path.join(base, 'private-ancestor-control');
  mkdirSync(privateHome, { mode: 0o700 });
  const [privateFile] = await backUp({ dir: path.join(privateHome, 'backups'), projects: ['sample'], storytree, now: new Date('2026-10-07T00:00:00Z') });
  assert.ok(privateFile);
  assert.equal(mode(privateHome), '0700');
  assert.equal(mode(privateFile), '0644');
  console.log(JSON.stringify({ case: 'private-ancestor-control', ancestorMode: mode(privateHome), fileMode: mode(privateFile), ancestorBlocksOtherUsersByPosixMode: true }));

  const automaticDir = path.join(base, 'automatic-startup');
  let complete!: () => void;
  const completed = new Promise<void>(resolve => { complete = resolve; });
  const log: string[] = [];
  const backups = keepBackups({ dir: automaticDir, storytree: { ...storytree, listProjects: async () => ['sample'] }, log: line => { log.push(line); complete(); } });
  const deadline = setTimeout(() => { throw new Error('bounded-startup-backup-timeout'); }, 2000);
  try { await completed; } finally { clearTimeout(deadline); backups.stop(); }
  assert.equal(log.length, 1);
  assert.match(log[0], /^backups: 1 project snapshot in /);
  const automaticFile = path.join(automaticDir, 'sample', readdirSync(path.join(automaticDir, 'sample'))[0]);
  assert.deepEqual(JSON.parse(readFileSync(automaticFile, 'utf8')), snapshot('sample'));
  assert.equal(mode(automaticFile), '0644');
  console.log(JSON.stringify({ case: 'real-keepBackups-startup', fileMode: mode(automaticFile), exactSyntheticSnapshotPreserved: true, timerStopped: true }));

  const retentionDir = path.join(base, 'retention-control');
  for (let day = 1; day <= 3; day++) {
    await backUp({ dir: retentionDir, projects: ['sample'], storytree, now: new Date(`2026-10-0${day}T00:00:00Z`), keep: 2 });
    if (day === 1) writeFileSync(path.join(retentionDir, 'sample', 'unrelated.txt'), 'synthetic');
  }
  assert.deepEqual(readdirSync(path.join(retentionDir, 'sample')).sort(), ['2026-10-02T00-00-00-000Z.json', '2026-10-03T00-00-00-000Z.json', 'unrelated.txt']);
  console.log(JSON.stringify({ case: 'bounded-retention-control', newestTwoRetained: true, unrelatedFilePreserved: true }));
  console.log(JSON.stringify({ scope: 'real-imported-backUp-and-keepBackups-with-in-memory-snapshot-provider', secondIdentityRead: 'not-attempted', ancestorModes: ['/', '/work', base].map(file => ({ file, mode: mode(file) })) }));
} finally {
  process.umask(originalUmask);
}
