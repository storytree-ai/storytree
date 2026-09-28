import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Vector3 } from 'three';
import { parseWisp } from './wisp-mesh.js';

test('the shipped wisp loads a solid core inside a volumetric shell, within its orbiting budget', async () => {
  const bytes = readFileSync(new URL('../assets/wisp.glb', import.meta.url));
  const { core, shell } = await parseWisp(bytes);
  assert.ok(bytes.byteLength < 30_000, 'many sessions share a small embedded asset');
  let triangles = 0;
  for (const geometry of [core, shell]) {
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    assert.ok(Math.min(size.x, size.y, size.z) > 1, 'a body has depth on all three axes');
    assert.ok(geometry.hasAttribute('normal'), 'the model can receive dimensional lighting');
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
  }
  assert.ok(triangles <= 300, 'the body stays inexpensive when many islands have sessions');
  assert.ok(shell.boundingBox!.containsBox(core.boundingBox!), 'the luminous core sits inside the shell');
  assert.ok(-shell.boundingBox!.min.x > shell.boundingBox!.max.x, 'the tail trails along local -X');
});
