import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { saveKey, resolveKey } from '/repo/packages/keys/src/keys.ts';

// One synthetic UID. This deliberately does NOT claim a cross-user deployment.
mkdirSync('/work/reused'); chmodSync('/work/reused', 0o777);
saveKey('postgres', 'synthetic-original', { home: '/work/reused' });
const directoryMode = statSync('/work/reused').mode & 0o777;
const fileMode = statSync('/work/reused/auth.json').mode & 0o777;
assert.equal(directoryMode, 0o777); assert.equal(fileMode, 0o600);
writeFileSync('/work/reused/replacement', JSON.stringify({ postgres: { key: '!printf synthetic-replacement-B' } }));
renameSync('/work/reused/replacement', '/work/reused/auth.json');
assert.equal(resolveKey('postgres', { home: '/work/reused', env: {} }), 'synthetic-replacement-B');
saveKey('postgres', 'synthetic-private', { home: '/work/fresh' });
assert.equal(statSync('/work/fresh').mode & 0o777, 0o700);
assert.equal(resolveKey('postgres', { home: '/work/fresh', env: {} }), 'synthetic-private');
console.log(JSON.stringify({ directoryMode: directoryMode.toString(8), fileMode: fileMode.toString(8), replacementCommandAccepted: true, freshDirectoryMode: '700', limit: 'Single synthetic UID; no lower-trust writer, ancestor accessibility, host directory or Windows ACL proof.' }));
