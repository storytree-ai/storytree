/**
 * Capability 2 · Fixed-colour icon files: the mark rendered to pixels from the master's shapes (the small-size drawing's at
 * 16 pixels, ADR-0999), by supersampled coverage over the canvas tile. Only + - * / and square roots, so the pixels are the same on every platform.
 */
import { BOX, TILE_RADIUS, shapesAt, resolveColours, type MarkColours, type Shape } from "./drawing.js";

type Rgb = readonly [number, number, number];
type Test = (x: number, y: number) => boolean;

function rgb(colour: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (m === null) throw new Error(`A fixed-colour file needs #rrggbb colours, not "${colour}".`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** The inside test of one shape, in the box's coordinates. */
function inside(shape: Shape): Test {
  switch (shape.kind) {
    case "circle": {
      const { cx, cy, r } = shape;
      return (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = shape;
      return (x, y) => ((x - cx) / rx) * ((x - cx) / rx) + ((y - cy) / ry) * ((y - cy) / ry) <= 1;
    }
    case "blob": {
      const { dx, dy, s } = shape.frame;
      const polygon: [number, number][] = [];
      let [px, py] = shape.start;
      for (const [[ax, ay], [bx, by], [cx, cy]] of shape.curves) {
        for (let i = 1; i <= 32; i++) {
          const t = i / 32, u = 1 - t;
          polygon.push([u * u * u * px + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * cx, u * u * u * py + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * cy]);
        }
        [px, py] = [cx, cy];
      }
      const points = polygon.map(([x, y]) => [dx + s * x, dy + s * y] as const);
      // Where the edges cross each row, sorted and kept by row: a sample is inside when an odd number lie to its left.
      const rows = new Map<number, number[]>();
      const crossings = (y: number): number[] => {
        let row = rows.get(y);
        if (row === undefined) {
          row = [];
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
            if (yi > y !== yj > y) row.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
          }
          row.sort((a, b) => a - b);
          rows.set(y, row);
        }
        return row;
      };
      return (x, y) => {
        let left = 0;
        for (const at of crossings(y)) {
          if (x < at) break;
          left++;
        }
        return left % 2 === 1;
      };
    }
    case "line": {
      const { dx, dy, s } = shape.frame;
      const [ax, ay] = [dx + s * shape.from[0], dy + s * shape.from[1]];
      const [bx, by] = [dx + s * shape.to[0], dy + s * shape.to[1]];
      const half = (s * shape.width) / 2;
      const [vx, vy] = [bx - ax, by - ay];
      const length2 = vx * vx + vy * vy;
      return (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / length2));
        const [ex, ey] = [x - ax - t * vx, y - ay - t * vy];
        return ex * ex + ey * ey <= half * half;
      };
    }
  }
}

/** A box that holds the shape (a cubic's control points hold its curve): [left, top, right, bottom]. */
function bounds(shape: Shape): readonly [number, number, number, number] {
  const box = (xs: number[], ys: number[], pad = 0) => [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad] as const;
  switch (shape.kind) {
    case "circle": return box([shape.cx], [shape.cy], shape.r);
    case "ellipse": return [shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx, shape.cy + shape.ry];
    case "blob": {
      const { dx, dy, s } = shape.frame;
      const points = [shape.start, ...shape.curves.flat()];
      return box(points.map(([x]) => dx + s * x), points.map(([, y]) => dy + s * y));
    }
    case "line": {
      const { dx, dy, s } = shape.frame;
      return box([shape.from[0], shape.to[0]].map((x) => dx + s * x), [shape.from[1], shape.to[1]].map((y) => dy + s * y), (s * shape.width) / 2);
    }
  }
}

/** Inside the 104 x 104 tile with its rounded corners. */
function inTile(x: number, y: number): boolean {
  const r = TILE_RADIUS;
  const cx = Math.max(r, Math.min(BOX - r, x)), cy = Math.max(r, Math.min(BOX - r, y));
  return x >= 0 && y >= 0 && x <= BOX && y <= BOX && (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

/**
 * The mark in a colourway (or #rrggbb colours with a canvas) as size x size straight RGBA pixels, row by row: the
 * small-size drawing at the sizes that use it, the master at every other.
 */
export function renderMark(colours: MarkColours | string, size: number): Uint8Array {
  return renderShapes(shapesAt(size), colours, size);
}

/** The given shapes on the tile, in a colourway (or #rrggbb colours with a canvas), as size x size straight RGBA pixels. */
function renderShapes(shapes: readonly Shape[], colours: MarkColours | string, size: number): Uint8Array {
  const c = resolveColours(colours);
  if (c.canvas === undefined) throw new Error("A fixed-colour file needs a canvas colour.");
  const canvas = rgb(c.canvas);
  const layers = shapes.map((shape) => {
    const [left, top, right, bottom] = bounds(shape);
    return { left, top, right, bottom, test: inside(shape), colour: rgb(c[shape.role]) };
  });
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
          if (!inTile(x, y)) continue;
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
