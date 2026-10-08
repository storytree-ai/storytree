import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { graduate, memoryWorklist } from '/repo/packages/librarian/src/graduation/graduation.ts';
import { worklistView } from '/repo/packages/librarian/src/rounds/rounds.ts';

const base = '/work/memory-case';
const folder = `${base}/checkout/memory`;
mkdirSync(folder, { recursive: true });
const outside = `${base}/outside.txt`;
const ordinary = `${folder}/ordinary.md`;
const link = `${folder}/linked.md`;
writeFileSync(outside, 'SYNTHETIC OUTSIDE CONTENT');
writeFileSync(ordinary, 'SYNTHETIC ORDINARY MEMORY');
writeFileSync(`${folder}/MEMORY.md`, '- [ordinary](ordinary.md)\n- [linked](linked.md)\n');
symlinkSync(outside, link);
const memories = await memoryWorklist([folder]);
assert.equal(memories.length, 2);
assert.equal(memories.find(item => item.file === link)?.text, 'SYNTHETIC OUTSIDE CONTENT');
assert.equal(memories.find(item => item.file === ordinary)?.text, 'SYNTHETIC ORDINARY MEMORY');
assert.deepEqual(worklistView({ graduation: memories, friction: [] }).graduation, memories);
await assert.rejects(graduate({ async defineTerm() { throw new Error('synthetic refusal'); } } as never,
  outside, 'definition', { term: 'Synthetic', meaning: 'Synthetic' }), /synthetic refusal/);
assert.ok(existsSync(outside), 'failed library write preserves the supplied file');
let accepted = 0;
const fakeLibrary = { async defineTerm(fields: unknown) { accepted++; return { id: 'synthetic-note', type: 'definition', fields }; } };
await graduate(fakeLibrary as never, ordinary, 'definition', { term: 'Synthetic', meaning: 'Synthetic' });
assert.equal(existsSync(ordinary), false);
assert.equal(readFileSync(`${folder}/MEMORY.md`, 'utf8'), '- [linked](linked.md)\n');
await graduate(fakeLibrary as never, link, 'definition', { term: 'Synthetic', meaning: 'Synthetic' });
assert.equal(lstatSync(link, { throwIfNoEntry: false }), undefined, 'graduating symlink removes the link');
assert.ok(existsSync(outside), 'graduating symlink does not delete its target');
await graduate(fakeLibrary as never, outside, 'definition', { term: 'Synthetic', meaning: 'Synthetic' });
assert.equal(existsSync(outside), false, 'caller-supplied non-memory path is deleted after accepted write');
assert.equal(accepted, 3);
console.log(JSON.stringify({ passed: true, outsideSymlinkContentReturned: true, nonMemoryPathDeletedAfterStubWrite: true,
  controls: ['ordinary memory returned and graduated', 'failed write preserved file', 'symlink graduation preserved target'],
  scope: 'Real memoryWorklist, worklistView and graduate; disposable synthetic files and inert library stubs. No tool host, authorization boundary or attacker receipt of content demonstrated.' }, null, 2));
