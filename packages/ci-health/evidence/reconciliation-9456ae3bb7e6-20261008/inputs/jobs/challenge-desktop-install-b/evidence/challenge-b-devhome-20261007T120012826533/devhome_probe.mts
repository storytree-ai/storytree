import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeDevHome } from '/repo/packages/app-setup/src/connect/dev-home.ts';

const base = '/work/challenge-b-devhome';
mkdirSync(base, { mode: 0o755 });
const source = path.join(base, 'synthetic-sign-in');
mkdirSync(source, { mode: 0o700 });
const synthetic = JSON.stringify({ syntheticOnly: 'challenge-b-placeholder-not-a-credential' });
writeFileSync(path.join(source, 'auth.json'), synthetic, { mode: 0o600 });
const mode = (file: string) => (statSync(file).mode & 0o777).toString(8).padStart(4, '0');
const stop = new Error('intentional-stop-before-build');
const originalUmask = process.umask();
try {
  for (const mask of [0o022, 0o077]) {
    process.umask(mask);
    const dir = path.join(base, `mask-${mask.toString(8)}`);
    let reachedBuild = false;
    await assert.rejects(makeDevHome({
      dir, harnesses: ['codex'], signedIn: { codex: source },
      build: async () => { reachedBuild = true; throw stop; },
    }), (error) => error === stop);
    const marker = path.join(dir, 'storytree-dev-home.json');
    const copy = path.join(dir, 'home', '.codex', 'auth.json');
    const parsed = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(parsed.codexSignIn.copied, synthetic);
    assert.equal(readFileSync(copy, 'utf8'), synthetic);
    assert.equal(mode(copy), '0600');
    assert.equal(mode(dir), mask === 0o022 ? '0755' : '0700');
    assert.equal(mode(marker), mask === 0o022 ? '0644' : '0600');
    assert.equal(reachedBuild, true);
    assert.equal(existsSync(path.join(dir, 'tools')), false);
    assert.equal(existsSync(path.join(dir, 'home', '.storytree', '0.3', 'app.json')), false);
    console.log(JSON.stringify({ case: 'synthetic-codex-selected', umask: mask.toString(8), markerMode: mode(marker), directoryMode: mode(dir), copyMode: mode(copy), exactSyntheticDuplicate: true, stoppedBeforeBuild: true }));
  }
  process.umask(0o022);
  const dir = path.join(base, 'no-codex-control');
  await assert.rejects(makeDevHome({ dir, harnesses: [], signedIn: { codex: source }, build: async () => { throw stop; } }), (error) => error === stop);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'storytree-dev-home.json'), 'utf8')).codexSignIn, undefined);
  assert.equal(existsSync(path.join(dir, 'home', '.codex', 'auth.json')), false);
  console.log(JSON.stringify({ case: 'no-codex-control', signInNotCopied: true }));
  console.log(JSON.stringify({ scope: 'real-imported-makeDevHome-through-line-61', sourceDirectoryMode: mode(source), sourceFileMode: mode(path.join(source, 'auth.json')), secondIdentityRead: 'not-attempted', ancestorModes: ['/', '/work', base].map(file => ({ file, mode: mode(file) })) }));
} finally {
  process.umask(originalUmask);
}
