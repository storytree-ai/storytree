import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkedCounts, checkedManifest } from './host.mjs';

test('a backup is refused when a restore loses rows, adds tables, or omits tables', () => {
  const source = { 'public.record': '17', 'public.record_event': '43' };
  assert.doesNotThrow(() => checkedCounts(source, { ...source }));
  for (const restored of [{ ...source, 'public.record': '16' }, { ...source, extra: '0' }, { 'public.record': '17' }]) {
    assert.throws(() => checkedCounts(source, restored), /row counts/);
  }
});

test('a restore accepts only a complete manifest with safe dump names and hashes', () => {
  const databases = ['storytree_storytree', 'storytree-activity', 'storytree-trunks'];
  const good = { format: 1, databases: databases.map(name => ({ name, file: `${name}.dump`, sha256: 'a'.repeat(64), bytes: 123, rows: { 'public.record': '1' } })) };
  assert.doesNotThrow(() => checkedManifest(good));
  // The lag runner's history (storytree-lag) is backed up beside them; a backup from before it joined still restores.
  const lag = { ...good.databases[0], name: 'storytree-lag', file: 'storytree-lag.dump' };
  assert.doesNotThrow(() => checkedManifest({ ...good, databases: [...good.databases, lag] }));
  assert.throws(() => checkedManifest({ ...good, databases: [...good.databases.slice(1), lag] }), /manifest/);
  // So is the QA ledger (storytree-quality), whose review history cannot be re-run.
  const quality = { ...good.databases[0], name: 'storytree-quality', file: 'storytree-quality.dump' };
  assert.doesNotThrow(() => checkedManifest({ ...good, databases: [...good.databases, lag, quality] }));
  assert.throws(() => checkedManifest({ ...good, databases: [...good.databases, quality] }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.slice(1) }), /manifest/);
  // 0.2's frozen store was archived once, never backed up from Mint.
  assert.throws(() => checkedManifest({ ...good, databases: [...good.databases, { ...good.databases[0], name: 'storytree', file: 'storytree.dump' }] }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.map(d => ({ ...d, file: '../outside.dump' })) }), /manifest/);
  assert.throws(() => checkedManifest({ ...good, databases: good.databases.map(d => ({ ...d, sha256: 'wrong' })) }), /manifest/);
});
