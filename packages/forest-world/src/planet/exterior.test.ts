import assert from 'node:assert/strict';
import test from 'node:test';
import { globeExterior } from './exterior.js';

test('4.7 the map hides its island grounds and roads independently, keeping plate children; hiding the exterior hides all of it', () => {
  assert.deepEqual(globeExterior(true, undefined), { plates: true, grounds: true, roads: true });
  assert.deepEqual(globeExterior(true, { grounds: false }), { plates: true, grounds: false, roads: true },
    'bare grounds still mount the plates, and with them their children');
  assert.deepEqual(globeExterior(true, { roads: false }), { plates: true, grounds: true, roads: false });
  assert.deepEqual(globeExterior(false, { grounds: true, roads: true }),
    { plates: false, grounds: false, roads: false }, 'surface=false wins over every switch');
});
