import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedCounts, checkedManifest, checkFreeze } from './host.mjs';

test('a backup is refused when a restore loses rows, adds tables, or omits tables', () => {
  const source = { 'public.record': '17', 'public.record_event': '43' };
  assert.doesNotThrow(() => checkedCounts(source, { ...source }));
  for (const restored of [{ ...source, 'public.record': '16' }, { ...source, extra: '0' }, { 'public.record': '17' }]) {
    assert.throws(() => checkedCounts(source, restored), /row counts/);
  }
});

test('a restore accepts only a complete manifest with safe dump names and hashes', () => {
  const databases = ['storytree_storytree', 'storytree-activity', 'storytree-trunks', 'storytree'];
  const good = { format: 1, databases: databases.map(name => ({ name, file: `${name}.dump`, sha256: 'a'.repeat(64), bytes: 123, rows: { 'public.record': '1' } })) };
  assert.doesNotThrow(() => checkedManifest(good));
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.slice(1) }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.map(d => ({ ...d, file: '../outside.dump' })) }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.map(d => ({ ...d, sha256: 'wrong' })) }), /manifest/);
});

test('cutover refuses a stale, wrong-direction or incomplete freeze attestation', () => {
  const now = Date.now();
  const good = { direction: 'cutover', at: new Date(now).toISOString(), owner: 'mickh', laptopPaused: true, mintPaused: true, ciPaused: true, backupTimerPaused: true };
  assert.doesNotThrow(() => checkFreeze(good, 'cutover', now));
  for (const bad of [{ ...good, ciPaused: false }, { ...good, direction: 'rollback' }, { ...good, at: new Date(now - 3600000).toISOString() }]) {
    assert.throws(() => checkFreeze(bad, 'cutover', now), /freeze/);
  }
});
