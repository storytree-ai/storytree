/**
 * Capability 2 · Fixed-colour icon files: the mark rendered to pixels from the master's shapes, by supersampled coverage
 * over the canvas tile. Only + - * / and square roots, so the pixels are the same on every platform.
 */
import { BOX, SHAPES, TILE_RADIUS, resolveColours, type MarkColours, type Shape } from "./drawing.js";

type Rgb = readonly [number, number, number];
type Test = (x: number, y: number) => boolean;

function rgb(colour: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (m === null) throw new Error(`A fixed-colour file needs #rrggbb colours, not "${colour}".`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Inside a rectangle with rounded corners. */
function inRounded(x: number, y: number, left: number, top: number, right: number, bottom: number, r: number): boolean {
  const cx = Math.max(left + r, Math.min(right - r, x)), cy = Math.max(top + r, Math.min(bottom - r, y));
  return x >= left && y >= top && x <= right && y <= bottom && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

/** One flat shape's inside test and a box that holds it [left, top, right, bottom], both before it is laid on its plane. */
function flat(shape: Shape): { test: Test; box: readonly [number, number, number, number] } {
  switch (shape.kind) {
    case "rect": {
      const [left, top, right, bottom] = [shape.x, shape.y, shape.x + shape.width, shape.y + shape.height];
      return { box: [left, top, right, bottom], test: (x, y) => inRounded(x, y, left, top, right, bottom, shape.r) };
    }
    case "circle": {
      const { cx, cy, r } = shape;
      return { box: [cx - r, cy - r, cx + r, cy + r], test: (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r };
    }
    case "line": {
      const [[ax, ay], [bx, by]] = [shape.from, shape.to];
      const half = shape.width / 2;
      const [vx, vy] = [bx - ax, by - ay];
      const length2 = vx * vx + vy * vy;
      return {
        box: [Math.min(ax, bx) - half, Math.min(ay, by) - half, Math.max(ax, bx) + half, Math.max(ay, by) + half],
        test: (x, y) => {
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / length2));
          const [ex, ey] = [x - ax - t * vx, y - ay - t * vy];
          return ex * ex + ey * ey <= half * half;
        },
      };
    }
  }
}

/** One shape as it lies in the box: a box that holds it there, and its inside test, which asks the flat shape about the point the plane brought here. */
function laid(shape: Shape): { left: number; top: number; right: number; bottom: number; test: Test } {
  const { a, b, c, d, e, f } = shape.plane;
  const { test, box: [l, t, r, bt] } = flat(shape);
  const xs = [l, r].flatMap((x) => [t, bt].map((y) => a * x + c * y + e));
  const ys = [l, r].flatMap((x) => [t, bt].map((y) => b * x + d * y + f));
  const det = a * d - b * c;
  return {
    left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys),
    test: (x, y) => test((d * (x - e) - c * (y - f)) / det, (a * (y - f) - b * (x - e)) / det),
  };
}

/** The mark on its tile, in a colourway (or #rrggbb colours with a canvas), as size x size straight RGBA pixels, row by row. */
export function renderMark(colours: MarkColours | string, size: number): Uint8Array {
  const c = resolveColours(colours);
  if (c.canvas === undefined) throw new Error("A fixed-colour file needs a canvas colour.");
  const canvas = rgb(c.canvas);
  const layers = SHAPES.map((shape) => ({ ...laid(shape), colour: rgb(c[shape.role]) }));
  const samples = size <= 64 ? 8 : 4;
  const step = BOX / size / samples;
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < samples; sy++) {
        const y = (py * samples + sy + 0.5) * step;
        for (let sx = 0; sx < samples; sx++) {
          const x = (px * samples + sx + 0.5) * step;
          if (!inRounded(x, y, 0, 0, BOX, BOX, TILE_RADIUS)) continue;
          let colour = canvas;
          for (const l of layers) if (x >= l.left && x <= l.right && y >= l.top && y <= l.bottom && l.test(x, y)) colour = l.colour;
          r += colour[0]; g += colour[1]; b += colour[2]; a += 1;
        }
      }
      const at = (py * size + px) * 4;
      if (a > 0) {
        pixels[at] = Math.round(r / a);
        pixels[at + 1] = Math.round(g / a);
        pixels[at + 2] = Math.round(b / a);
        pixels[at + 3] = Math.round((255 * a) / (samples * samples));
      }
    }
  }
  return pixels;
}
