import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VerbRefusal, type DoorWords } from '@storytree/library/verbs';
import { PROCESSES_FAMILIES } from './verbs.js';

const WORDS: DoorWords = { door: 'command', say: step => `storytree ${step.command}` };

test('3.3 the declared processes verbs refuse a place with no session, pointing to --all, and read every session with --all offline', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'processes-verbs-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const [family] = PROCESSES_FAMILIES;
  const nobody = { folder };
  const identity = (error: unknown) => error instanceof VerbRefusal && !error.misuse && /session identity.*--all/s.test(error.message);
  await assert.rejects(family!.bare!.act({ all: false }, nobody, WORDS), identity);
  for (const verb of family!.verbs) await assert.rejects(verb.act({ runs: ['run-1'] }, nobody, WORDS), identity);
  const all = await family!.bare!.act({ all: true }, nobody, WORDS);
  assert.match(all.text, /storytree app and database/);
});
