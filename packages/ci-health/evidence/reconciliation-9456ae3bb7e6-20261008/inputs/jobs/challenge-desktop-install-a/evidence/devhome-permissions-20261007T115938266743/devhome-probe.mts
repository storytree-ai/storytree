import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeDevHome } from '/repo/packages/app-setup/src/connect/dev-home.ts';

// Only synthetic sign-in data in the broker's disposable /work is accessed.
const root = '/work/challenge-devhome';
mkdirSync(root, { mode: 0o755 });
const source = path.join(root, 'synthetic-sign-in');
mkdirSync(source, { mode: 0o700 });
const synthetic = JSON.stringify({ synthetic_only: 'challenge-a-not-a-credential' });
writeFileSync(path.join(source, 'auth.json'), synthetic, { mode: 0o600 });
const mode = (file: string) => (statSync(file).mode & 0o777).toString(8);
const before = process.umask();
try {
  for (const mask of [0o022, 0o077]) {
    process.umask(mask);
    const dir = path.join(root, `mask-${mask.toString(8)}`);
    let stoppedBeforeBuild = false;
    const stop = new Error('bounded probe: stop before build');
    await assert.rejects(makeDevHome({
      dir, harnesses: ['codex'], signedIn: { codex: source },
      build: async () => { stoppedBeforeBuild = true; throw stop; },
      run: async () => { throw new Error('Agent registration must not run'); },
    }), error => error === stop);
    assert.equal(stoppedBeforeBuild, true);
    const marker = path.join(dir, 'storytree-dev-home.json');
    const copy = path.join(dir, 'home', '.codex', 'auth.json');
    const data = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(data.codexSignIn.copied, synthetic);
    assert.equal(readFileSync(copy, 'utf8'), synthetic);
    assert.equal(mode(copy), '600');
    assert.equal(mode(marker), mask === 0o022 ? '644' : '600');
    assert.equal(mode(dir), mask === 0o022 ? '755' : '700');
    console.log(JSON.stringify({ case: 'codex-synthetic', umask: mask.toString(8), sourceMode: mode(path.join(source, 'auth.json')), markerMode: mode(marker), dirMode: mode(dir), authCopyMode: mode(copy), duplicatesSyntheticData: true, stoppedBeforeBuild }));
  }
  process.umask(0o022);
  for (const kind of ['codex-not-selected', 'no-sign-in-file']) {
    const dir = path.join(root, kind);
    const stop = new Error('bounded probe: stop before build');
    await assert.rejects(makeDevHome({
      dir, harnesses: kind === 'codex-not-selected' ? [] : ['codex'],
      signedIn: { codex: kind === 'codex-not-selected' ? source : path.join(root, 'missing-synthetic-source') },
      build: async () => { throw stop; },
    }), error => error === stop);
    const data = JSON.parse(readFileSync(path.join(dir, 'storytree-dev-home.json'), 'utf8'));
    assert.equal(data.codexSignIn, undefined);
    assert.equal(existsSync(path.join(dir, 'home', '.codex', 'auth.json')), false);
    console.log(JSON.stringify({ case: kind, containsSignIn: false }));
  }
} finally { process.umask(before); }
