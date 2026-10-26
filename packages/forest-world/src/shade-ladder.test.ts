import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHT_DIRECTION } from './shade-ladder.js';

test('LIGHT_DIRECTION is NORMALISED, and points from the authored quadrant', () => {
  const len = Math.hypot(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z);
  assert.ok(Math.abs(len - 1) < 1e-12, `light direction length ${len}`);
  assert.ok(LIGHT_DIRECTION.y > 0.5, 'the light is above the viewing plane');
  assert.ok(LIGHT_DIRECTION.x < 0, 'the light is on the -x side');
  assert.ok(LIGHT_DIRECTION.z > 0, 'and the +z side');
});
