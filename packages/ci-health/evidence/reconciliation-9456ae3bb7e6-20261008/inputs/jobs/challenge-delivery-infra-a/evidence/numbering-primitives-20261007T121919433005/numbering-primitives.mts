import assert from 'node:assert/strict';
import { numbered, NumberTakenError } from '/repo/packages/library/src/transactions/records.ts';

// Pure allocator only. No SQL, role, database, library connection or persistent record.
const input = {
  id: 'synthetic-decision', type: 'decision', version: 2,
  fields: { title: 'Synthetic', text: 'Synthetic', status: 'accepted' },
  sequence: 'number', sequenceFloor: 5, sequenceNeverHeld: true,
};
assert.equal(numbered(input, 3, () => false).fields.number, 6);
assert.equal(numbered(input, 20, () => false).fields.number, 21);
const explicit = { ...input, fields: { ...input.fields, number: 20 } };
assert.equal(numbered(explicit, 20, () => false).fields.number, 20);
assert.throws(() => numbered(explicit, 20, () => true), NumberTakenError);
console.log(JSON.stringify({ pureAllocator: 'passed', baseline: 6, suppliedHistoryMaximum: 20, allocated: 21, explicitTakenRejected: true, sqlAndRlsExecuted: false }));
