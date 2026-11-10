/**
 * Capability 1 · Master drawing and colour roles. The owner's chosen mark (2026-11-10): a flat map sheet lying at a slant,
 * its edge showing below it, and a tree drawn on the sheet, a trunk under a canopy of four circles. The geometry is held
 * once here, as shapes in a 104 x 104 box, each drawn flat and then laid on a slanted plane; the SVG is written from them
 * and the fixed-colour files are rendered from them. No role has a colour of its own.
 */

/** The four roles every surface supplies, as any CSS colour (a CSS variable included): the map sheet, its edge, the tree's trunk and its leaves. */
export interface MarkRoles {
  edge: string;
  sheet: string;
  tree: string;
  leaf: string;
}

/** The roles and, optionally, the canvas: given one, the 104 x 104 tile (corner radius 24) is drawn behind the mark. */
export type MarkColours = MarkRoles & { canvas?: string };

/** The named colourways: defaults only for files that cannot follow a theme (.ico, .icns, PNG), never the mark's colours. */
export const COLOURWAYS: Readonly<Record<string, Required<MarkColours>>> = {
  day: { canvas: "#3E7CB1", edge: "#D9CFB4", sheet: "#F4EFE2", tree: "#17301F", leaf: "#3E8E4E" },
  night: { canvas: "#0F1E2E", edge: "#214F2A", sheet: "#2F6B3A", tree: "#F4EFE2", leaf: "#F2C14E" },
};

export const BOX = 104;
export const TILE_RADIUS = 24;

export type Role = keyof MarkRoles;
type Point = readonly [number, number];
/** Where a flat shape lies in the box, as SVG's matrix(a b c d e f): x' = a x + c y + e, y' = b x + d y + f. */
export interface Plane { a: number; b: number; c: number; d: number; e: number; f: number }

/** A flat shape and the plane it lies on. */
export type Shape = { role: Role; plane: Plane } & (
  | { kind: "rect"; x: number; y: number; width: number; height: number; r: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  /** A straight line with round caps. */
  | { kind: "line"; from: Point; to: Point; width: number }
);

/** The sheet's slant: its near corner low on the left, its far corner high on the right, seen from above. */
const SHEET: Plane = { a: 0.95, b: -0.25, c: 0.3, d: 0.8, e: -13, f: 21.4 };
/** The sheet's thickness: the same square, six lower. */
const EDGE: Plane = { ...SHEET, f: SHEET.f + 6 };

const square = { kind: "rect", x: 17, y: 17, width: 70, height: 70, r: 8 } as const;

/** Every shape of the mark, back to front. */
export const SHAPES: readonly Shape[] = [
  { ...square, role: "edge", plane: EDGE },
  { ...square, role: "sheet", plane: SHEET },
  { kind: "line", role: "tree", plane: SHEET, from: [52, 80], to: [52, 54], width: 6 },
  { kind: "circle", role: "leaf", plane: SHEET, cx: 39, cy: 48, r: 13 },
  { kind: "circle", role: "leaf", plane: SHEET, cx: 65, cy: 48, r: 13 },
  { kind: "circle", role: "leaf", plane: SHEET, cx: 52, cy: 36, r: 15 },
  { kind: "circle", role: "leaf", plane: SHEET, cx: 52, cy: 50, r: 10 },
];

/** The colours for a colourway's name, or the given colours with every role checked. */
export function resolveColours(colours: MarkColours | string): MarkColours {
  if (typeof colours === "string") {
    const way = COLOURWAYS[colours];
    if (way === undefined) throw new Error(`No colourway "${colours}": the mark's colourways are ${Object.keys(COLOURWAYS).join(", ")}.`);
    return way;
  }
  for (const role of ["edge", "sheet", "tree", "leaf"] as const) {
    if (typeof colours[role] !== "string" || colours[role] === "") throw new Error(`The mark needs a colour for its ${role} role.`);
  }
  return colours;
}

/** The mark's SVG in the given roles (or a named colourway), with the tile drawn behind it when a canvas is given. */
export function markSvg(colours: MarkColours | string): string {
  const c = resolveColours(colours);
  const out = [`<svg viewBox="0 0 ${BOX} ${BOX}" xmlns="http://www.w3.org/2000/svg">`];
  if (c.canvas !== undefined) out.push(`  <rect width="${BOX}" height="${BOX}" rx="${TILE_RADIUS}" fill="${c.canvas}"/>`);
  for (const shape of SHAPES) {
    const { a, b, c: skew, d, e, f } = shape.plane;
    const lie = `transform="matrix(${a} ${b} ${skew} ${d} ${e} ${f})"`;
    const fill = c[shape.role];
    if (shape.kind === "rect") {
      // Drawn as a path, so the tile stays the only <rect> a surface can find in the mark.
      const { x, y, width: w, height: h, r } = shape;
      const corner = (dx: number, dy: number) => `a${r} ${r} 0 0 1 ${dx} ${dy}`;
      out.push(`  <path ${lie} d="M${x + r} ${y} h${w - 2 * r} ${corner(r, r)} v${h - 2 * r} ${corner(-r, r)} h${2 * r - w} ${corner(-r, -r)} v${2 * r - h} ${corner(r, -r)} Z" fill="${fill}"/>`);
    }
    else if (shape.kind === "circle") out.push(`  <circle ${lie} cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${fill}"/>`);
    else out.push(`  <path ${lie} d="M${shape.from.join(" ")} L${shape.to.join(" ")}" stroke="${fill}" stroke-width="${shape.width}" stroke-linecap="round"/>`);
  }
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
