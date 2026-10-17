/**
 * Capability 7 · Master drawing and colour roles. The owner's chosen mark (2026-10-11): a globe, three islets and a main island,
 * and inside the main island a tree of five dots. The geometry is held once here, as shapes in a 104 x 104 box; the SVG is
 * written from them and the fixed-colour files are rendered from them; the 16-pixel files use a small-size variant generated
 * from the same shapes (ADR-0999). No role has a colour of its own.
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

const islets: Shape[] = [
  { kind: "ellipse", role: "land", cx: 30, cy: 36, rx: 7, ry: 4.5 },
  { kind: "ellipse", role: "land", cx: 26, cy: 62, rx: 5, ry: 4 },
  { kind: "ellipse", role: "land", cx: 72, cy: 30, rx: 5, ry: 3.5 },
];

const ISLAND_CURVES: readonly (readonly [Point, Point, Point])[] = [
  [[24, 36], [42, 26], [58, 28]],
  [[74, 30], [82, 44], [78, 60]],
  [[74, 76], [56, 80], [42, 76]],
  [[32, 73], [27, 66], [26, 54]],
];

const fork: Point = [0, 3];
const LIMBS = [[[0, 17], fork], [fork, [-14, -7]], [fork, [14, -7]], [fork, [0, -17]]] as const;

/** How bold the tree is drawn, in its own frame: its lines' width, and the radii of its root and fork dots and its leaf dots. */
interface Boldness { line: number; root: number; leaf: number }
const MASTER_BOLDNESS: Boldness = { line: 2.5, root: 3.5, leaf: 5 };

/**
 * The main island and its tree, grown k times about the point where the tree stands, (56, 57) in the master, and moved so
 * that point sits at (cx, cy): the island blob first, then the tree's four lines in tree, its root and fork dots in tree and
 * its three leaf dots in leaf.
 */
function islandAndTree(k: number, cx: number, cy: number, bold: Boldness): Shape[] {
  const s = 0.8 * k;
  const island: Shape = {
    kind: "blob", role: "land", frame: { dx: cx - s * 52, dy: cy - s * 53, s },
    svgTransform: `translate(${cx} ${cy}) scale(${s}) translate(-52 -53)`, start: [26, 54], curves: ISLAND_CURVES,
  };
  const tree: Frame = { dx: cx, dy: cy, s: 0.75 * k };
  const lines = LIMBS.map(([from, to]): Shape => ({ kind: "line", role: "tree", frame: tree, from, to, width: bold.line }));
  const dots: readonly { role: Role; at: Point; r: number }[] = [
    { role: "tree", at: [0, 17], r: bold.root },
    { role: "tree", at: fork, r: bold.root },
    { role: "leaf", at: [-14, -7], r: bold.leaf },
    { role: "leaf", at: [14, -7], r: bold.leaf },
    { role: "leaf", at: [0, -17], r: bold.leaf },
  ];
  return [island, ...lines, ...dots.map(({ role, at: [x, y], r }): Shape => ({ kind: "circle", role, cx: tree.dx + tree.s * x, cy: tree.dy + tree.s * y, r: tree.s * r }))];
}

/** Every shape of the mark, back to front, in the box's coordinates (blobs and lines carry their frame). */
export const SHAPES: readonly Shape[] = [
  { kind: "circle", role: "ocean", cx: 52, cy: 52, r: 36 },
  ...islets,
  ...islandAndTree(1, 56, 57, MASTER_BOLDNESS),
];

/**
 * ADR-0999 · The small-size drawing, A, the owner's pick for 16 pixels (2026-10-11): the master's own shapes and roles with
 * the globe grown to fill the tile, the three islets dropped, and the main island and its tree grown 1.75 times with the
 * tree's lines and dots bolder.
 */
export const SMALL_SHAPES: readonly Shape[] = [
  { kind: "circle", role: "ocean", cx: 52, cy: 52, r: 50 },
  ...islandAndTree(1.75, 52, 54, { line: 3.2, root: 4, leaf: 5.5 }),
];

/** The sizes, in pixels, whose fixed-colour files use the small-size drawing; every other size uses the master. */
export const SMALL_SIZES: readonly number[] = [16];

/** The shapes a fixed-colour file of this size is rendered from. */
export function shapesAt(size: number): readonly Shape[] {
  return SMALL_SIZES.includes(size) ? SMALL_SHAPES : SHAPES;
}

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
