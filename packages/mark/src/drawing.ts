/**
 * Capability 1 · Master drawing and colour roles. The owner's chosen mark (2026-10-11): a globe, three islets and a main island,
 * and inside the main island a tree of five dots. The geometry is held once here, as shapes in a 104 x 104 box; the SVG is
 * written from them and the fixed-colour files are rendered from them. No role has a colour of its own.
 */

/** The four roles every surface supplies, as any CSS colour (a CSS variable included). */
export interface MarkRoles {
  ocean: string;
  land: string;
  tree: string;
  leaf: string;
}

/** The roles and, optionally, the canvas: given one, the 104 x 104 tile (corner radius 24) is drawn behind the mark. */
export type MarkColours = MarkRoles & { canvas?: string };

/** The named colourways: defaults only for files that cannot follow a theme (.ico, .icns, PNG), never the mark's colours. */
export const COLOURWAYS: Readonly<Record<string, Required<MarkColours>>> = {
  day: { canvas: "#F4EFE2", ocean: "#3E7CB1", land: "#8cb85e", tree: "#17301F", leaf: "#17301F" },
  night: { canvas: "#0F1E2E", ocean: "#1F4E79", land: "#2F6B3A", tree: "#F4EFE2", leaf: "#F2C14E" },
};

export const BOX = 104;
export const TILE_RADIUS = 24;

export type Role = keyof MarkRoles;
type Point = readonly [number, number];
/** An affine map that only translates and scales: x' = dx + s * x, y' = dy + s * y. */
export interface Frame { dx: number; dy: number; s: number }

export type Shape =
  | { kind: "circle"; role: Role; cx: number; cy: number; r: number }
  | { kind: "ellipse"; role: Role; cx: number; cy: number; rx: number; ry: number }
  /** A closed path of cubic curves from `start`, in its own frame. */
  | { kind: "blob"; role: Role; frame: Frame; svgTransform: string; start: Point; curves: readonly (readonly [Point, Point, Point])[] }
  /** A straight line with round caps, in its own frame. */
  | { kind: "line"; role: Role; frame: Frame; from: Point; to: Point; width: number };

const ISLAND: Frame = { dx: 56 - 0.8 * 52, dy: 57 - 0.8 * 53, s: 0.8 };
const TREE: Frame = { dx: 56, dy: 57, s: 0.75 };

const islets: Shape[] = [
  { kind: "ellipse", role: "land", cx: 30, cy: 36, rx: 7, ry: 4.5 },
  { kind: "ellipse", role: "land", cx: 26, cy: 62, rx: 5, ry: 4 },
  { kind: "ellipse", role: "land", cx: 72, cy: 30, rx: 5, ry: 3.5 },
];

const island: Shape = {
  kind: "blob", role: "land", frame: ISLAND, svgTransform: "translate(56 57) scale(0.8) translate(-52 -53)",
  start: [26, 54],
  curves: [
    [[24, 36], [42, 26], [58, 28]],
    [[74, 30], [82, 44], [78, 60]],
    [[74, 76], [56, 80], [42, 76]],
    [[32, 73], [27, 66], [26, 54]],
  ],
};

const fork: Point = [0, 3];
const lines: Shape[] = ([[[0, 17], fork], [fork, [-14, -7]], [fork, [14, -7]], [fork, [0, -17]]] as const)
  .map(([from, to]) => ({ kind: "line", role: "tree", frame: TREE, from, to, width: 2.5 }));

/** The dots, in the tree's frame: the root and the fork in tree, the three leaves in leaf. */
const dots: readonly { role: Role; at: Point; r: number }[] = [
  { role: "tree", at: [0, 17], r: 3.5 },
  { role: "tree", at: fork, r: 3.5 },
  { role: "leaf", at: [-14, -7], r: 5 },
  { role: "leaf", at: [14, -7], r: 5 },
  { role: "leaf", at: [0, -17], r: 5 },
];

/** Every shape of the mark, back to front, in the box's coordinates (blobs and lines carry their frame). */
export const SHAPES: readonly Shape[] = [
  { kind: "circle", role: "ocean", cx: 52, cy: 52, r: 36 },
  ...islets,
  island,
  ...lines,
  ...dots.map(({ role, at: [x, y], r }): Shape => ({ kind: "circle", role, cx: TREE.dx + TREE.s * x, cy: TREE.dy + TREE.s * y, r: TREE.s * r })),
];

/** The colours for a colourway's name, or the given colours with every role checked. */
export function resolveColours(colours: MarkColours | string): MarkColours {
  if (typeof colours === "string") {
    const way = COLOURWAYS[colours];
    if (way === undefined) throw new Error(`No colourway "${colours}": the mark's colourways are ${Object.keys(COLOURWAYS).join(", ")}.`);
    return way;
  }
  for (const role of ["ocean", "land", "tree", "leaf"] as const) {
    if (typeof colours[role] !== "string" || colours[role] === "") throw new Error(`The mark needs a colour for its ${role} role.`);
  }
  return colours;
}

/** The mark's SVG in the given roles (or a named colourway), with the tile drawn behind it when a canvas is given. */
export function markSvg(colours: MarkColours | string): string {
  const c = resolveColours(colours);
  const n = (v: number) => String(Math.round(v * 1000) / 1000);
  const out = [`<svg viewBox="0 0 ${BOX} ${BOX}" xmlns="http://www.w3.org/2000/svg">`];
  if (c.canvas !== undefined) out.push(`  <rect width="${BOX}" height="${BOX}" rx="${TILE_RADIUS}" fill="${c.canvas}"/>`);
  for (const shape of SHAPES) {
    const fill = c[shape.role];
    if (shape.kind === "circle") out.push(`  <circle cx="${n(shape.cx)}" cy="${n(shape.cy)}" r="${n(shape.r)}" fill="${fill}"/>`);
    else if (shape.kind === "ellipse") out.push(`  <ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="${fill}"/>`);
    else if (shape.kind === "blob") {
      const d = `M${shape.start.join(" ")} ${shape.curves.map((curve) => `C${curve.map((p) => p.join(" ")).join(" ")}`).join(" ")} Z`;
      out.push(`  <path transform="${shape.svgTransform}" d="${d}" fill="${fill}"/>`);
    } else {
      const { dx, dy, s } = shape.frame;
      out.push(`  <path transform="translate(${dx} ${dy}) scale(${s})" d="M${shape.from.join(" ")} L${shape.to.join(" ")}" stroke="${fill}" stroke-width="${shape.width}" stroke-linecap="round"/>`);
    }
  }
  out.push("</svg>");
  return `${out.join("\n")}\n`;
}
