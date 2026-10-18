// The relief's height bound, which sizes the plates' clearance above the globe shell.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAND_RELIEF_AMPLITUDE, landHeightRange } from './land-relief.js';

test('the range scales with the amplitude, and zero amplitude has no range', () => {
  assert.ok(Math.abs(landHeightRange(1) * LAND_RELIEF_AMPLITUDE - landHeightRange()) < 1e-12);
  assert.equal(landHeightRange(0), 0);
});
