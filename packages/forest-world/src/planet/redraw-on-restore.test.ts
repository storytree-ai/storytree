// The globe's half of The drawing engine 4.15 that a headless test can reach: what it asks of its R3F root when the
// browser hands its canvas's WebGL context back. The browser half is the planet's context-loss capture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { redrawOnRestore } from './redraw-on-restore.js';

test('4.15 a globe asks for a frame when its drawing context comes back, and stops listening when unmounted', () => {
  const canvas = new EventTarget();
  let asked = 0;
  const stop = redrawOnRestore(() => ({ invalidate: () => { asked++; } }), canvas);
  canvas.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(asked, 0, 'losing the context asks for nothing');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(asked, 1, 'restored, it asks for a frame');
  stop();
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(asked, 1, 'unmounted, it asks for nothing');
});
