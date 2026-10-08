import assert from 'node:assert/strict';
import { mkdirSync, chmodSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { authFile, saveKey, resolveKey } from '/repo/packages/keys/src/keys.ts';

// The script controls only synthetic files in disposable /work. It does not model a second UID.
const privateHome = '/work/new-private-key-home';
saveKey('postgres', 'synthetic-private-value', { home: privateHome });
assert.equal(statSync(privateHome).mode & 0o777, 0o700);
assert.equal(statSync(authFile({ home: privateHome })).mode & 0o777, 0o600);
assert.equal(resolveKey('postgres', { home: privateHome, env: {} }), 'synthetic-private-value');
console.log(JSON.stringify({ case: 'new-private-home', directoryMode: '0700', fileMode: '0600', literalResolved: true }));

const sharedHome = '/work/existing-shared-key-home';
mkdirSync(sharedHome, { mode: 0o777 });
chmodSync(sharedHome, 0o777);
saveKey('postgres', 'synthetic-original-value', { home: sharedHome });
const file = authFile({ home: sharedHome });
assert.equal(statSync(file).mode & 0o777, 0o600);
assert.equal(statSync(sharedHome).mode & 0o777, 0o777);
unlinkSync(file);
writeFileSync(file, JSON.stringify({ postgres: { key: '!printf marker > /work/key-command-marker; printf synthetic-command-result' } }), { mode: 0o644 });
assert.equal(resolveKey('postgres', { home: sharedHome, env: {} }), 'synthetic-command-result');
assert.equal(existsSync('/work/key-command-marker'), true);
console.log(JSON.stringify({ case: 'existing-shared-home', directoryModeAfterSave: '0777', originalFileMode: '0600', replacementFileMode: '0644', replacementCommandExecuted: true, separatePrincipalTested: false }));
