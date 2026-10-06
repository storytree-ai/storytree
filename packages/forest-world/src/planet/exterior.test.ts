// The globe's half of world 6.7 that a headless test can reach: which of its exterior layers it draws for
// the host's switches. The camera and the inside sit outside this rule, so no switch reaches them.
import assert from 'node:assert/strict';
import test from 'node:test';
import { globeExterior } from './exterior.js';

test('6.7 the globe hides its sea, island grounds and roads independently, keeping plate children; hiding the exterior hides all of it', () => {
  assert.deepEqual(globeExterior(true, undefined), { sea: true, plates: true, grounds: true, roads: true });
  assert.deepEqual(globeExterior(true, { sea: false }), { sea: false, plates: true, grounds: true, roads: true });
  assert.deepEqual(globeExterior(true, { grounds: false }), { sea: true, plates: true, grounds: false, roads: true },
    'bare grounds still mount the plates, and with them their children');
  assert.deepEqual(globeExterior(true, { roads: false }), { sea: true, plates: true, grounds: true, roads: false });
  assert.deepEqual(globeExterior(false, { sea: true, grounds: true, roads: true }),
    { sea: false, plates: false, grounds: false, roads: false }, 'surface=false wins over every switch');
});
