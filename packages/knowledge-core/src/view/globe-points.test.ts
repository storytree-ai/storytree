/** The core's moving lines (ADR-0742, ADR-0797) redraw every frame while they animate; a frame only draws (ADR-0836 D1). */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InterleavedBufferAttribute } from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

import { moveLine } from "./globe-points.js";

const along = (shift: number) => Array.from({ length: 20 }, (_, i) => [i + shift, 2 * i, -i]).flat();
const colours = Array.from({ length: 20 }, (_, i) => [i / 20, 0.5, 1]).flat();
const buffer = (line: LineGeometry, name: string) => (line.getAttribute(name) as InterleavedBufferAttribute).data;

test("5.4 a line the core moves every frame keeps its GPU buffers, drawing the same line as one made afresh", () => {
  const line = new LineGeometry();
  moveLine(line, along(0), colours);
  const [points, tints] = [buffer(line, "instanceStart"), buffer(line, "instanceColorStart")];
  const uploaded = points.version;
  moveLine(line, along(0.5), colours);
  assert.equal(buffer(line, "instanceStart"), points, "its points are moved in place, not in a new buffer");
  assert.equal(buffer(line, "instanceEnd"), points);
  assert.equal(buffer(line, "instanceColorStart"), tints, "unchanged colours are not uploaded again");
  assert.ok(points.version > uploaded, "the moved points are uploaded");
  const fresh = new LineGeometry().setPositions(along(0.5)).setColors(colours);
  assert.deepEqual([...points.array], [...buffer(fresh, "instanceStart").array]);
  assert.deepEqual([...tints.array], [...buffer(fresh, "instanceColorStart").array]);
  assert.deepEqual(line.boundingSphere, fresh.boundingSphere, "it sorts among see-through things where it now is");
  assert.equal(line.instanceCount, fresh.instanceCount);
});
