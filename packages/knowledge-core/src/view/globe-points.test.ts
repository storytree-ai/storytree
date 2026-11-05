/** The core's moving lines (ADR-0742, ADR-0797) redraw every frame while they animate; a frame only draws (ADR-0836 D1). */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InterleavedBufferAttribute } from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

import { dotDrawing, dotOpacity, grownScale, moveLine } from "./globe-points.js";

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

test("1.15 with a story selected, every other story's note fades to a faint backdrop, never gone, unless the selected session lights it", () => {
  const own = dotOpacity({ state: null, lit: false, anyLit: false, quiet: false });
  const faded = dotOpacity({ state: null, lit: false, anyLit: false, quiet: true });
  assert.ok(faded >= 0.05 && faded <= 0.08, `faded to ${faded}`);
  assert.ok(faded < own / 5, "far quieter than the selected story's own");
  assert.equal(dotOpacity({ state: null, lit: true, anyLit: true, quiet: true }), 1, "a note the selected session read keeps its light");
  assert.equal(dotOpacity({ state: "in-window", lit: false, anyLit: true, quiet: true }), 1, "and one in its window");
});

test("4.24 the sheet's 754 notes are drawn with one ball per look and one material per look, colour and opacity, each dot scaled to its size, growing in and ringed in its scale, in its own colour and opacity", () => {
  const radius = 40, colours = ["#5ab0f0", "#e69f00", "#009e73", "#cc79a7"], opacities = [1, 0.52, 0.0624];
  const dots = Array.from({ length: 754 }, (_, i) => ({ shaded: i % 2 === 0, colour: colours[i % 4]!, opacity: opacities[i % 3]!, size: 0.01 + (i % 7) * 0.002, radius }));
  const drawn = dots.map(dot => dotDrawing(dot));
  assert.equal(new Set(drawn.map(({ geometry }) => geometry)).size, 2, "one ball for the flat look, one for the shaded");
  assert.equal(new Set(drawn.map(({ material }) => material)).size, new Set(dots.map(({ shaded, colour, opacity }) => `${shaded} ${colour} ${opacity}`)).size,
    "a material per look, colour and opacity, not one per note");
  dots.forEach((dot, i) => {
    const { geometry, material, scale, ring } = drawn[i]!;
    assert.equal(geometry.parameters.radius * scale, radius * dot.size, "drawn at its note's size");
    assert.ok(Math.abs(ring.radius * scale - radius * Math.max(0.015, dot.size + 0.006)) < 1e-9, "its window ring just outside it");
    assert.ok(Math.abs(ring.tube * scale - radius * 0.0022) < 1e-9, "a thin ring, whatever the dot's size");
    assert.equal(geometry.parameters.radius * grownScale(0.5, radius, dot.size), radius * dot.size / 2, "half grown in, half its size");
    assert.equal(material.opacity, dot.opacity);
    assert.equal(material.transparent, true, "faded dots show what is behind them");
    assert.equal(material.type, dot.shaded ? "MeshLambertMaterial" : "MeshBasicMaterial");
    if (!dot.shaded) assert.equal(`#${material.color.getHexString()}`, dot.colour);
  });
});
