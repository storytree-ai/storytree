/**
 * Capability 3 · Story node render: each settlement on the selected island drawn as round 12's flat architecture-diagram
 * symbol for its capability's kind (ADR-1236 D1, rollout 2 step 4a, 3.79), ported from the capability tree mock's
 * docs/design/capability-tree-3d/q-all-islands/kinds.mjs and tools/overlay.ts: its outline in ink on a paper fill over a
 * faint dark casing, laid flat on the land and as large as its settlement's `size`. Plain three.js geometry, so the
 * marks are read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LessDepth, Mesh, MeshBasicMaterial, ShapeUtils, Vector2, type Vector3 } from "three";
import type { IslandRoads } from "../territories/island-roads.js";

type Point = { readonly x: number; readonly z: number };
/** A point of a symbol in its 24-unit box centred on 0, y down the page as the mock's SVG (down the page is +z on the map). */
type G = readonly [number, number];
export type Kind = "store" | "service" | "queue" | "index" | "link" | "log";

/** The mock's ink and paper for a settlement, and its casing's colour and opacity (the pieces' style 1). */
export const SYMBOL_INK = { ink: "#2a2723", paper: "#f3efe4", casing: "#141a20", casingOpacity: 0.55 } as const;
/** The ink's width in the 24-unit box, and the casing's beyond it. */
const WIDTH = 2.1, CASING = 2.2;

/** The kind of each of The library's capabilities (the mock's KIND_OF, which numbered them by title, kept here by id so
 * no other story's capability takes a number's kind); every other capability is a service. */
const LIBRARY_KINDS: Readonly<Record<string, Kind>> = {
  capability_5e0362aae607: "store", // 1 · Project libraries
  capability_5a80222c88c4: "store", // 2 · Library transactions
  capability_a1d4fadbec3e: "store", // 3 · Data schema
  capability_dd486ffa5b02: "store", // 4 · Work model
  capability_f27ac2abb10b: "log", // 5 · Health record
  capability_baaeecb42577: "store", // 6 · Knowledge artifacts
  capability_75d059640d9d: "service", // 7 · Library API
  capability_a954e1eb16f6: "link", // 8 · Cloud connection (GCP)
  capability_13b04e769a4b: "index", // 9 · Knowledge entrances
  capability_a7f068502213: "queue", // 10 · Work in flight
  capability_d632ff0454c0: "queue", // 11 · Waits
  capability_5f1ce148e63a: "queue", // 12 · Owner questions
  capability_78d6e026f902: "log", // 13 · Decision log
  capability_556e276756c9: "index", // 14 · Ranked search
  capability_a6d2887aed63: "link", // 15 · Connection by address
  capability_984398616605: "service", // 16 · The command schema
  capability_dce9495fcaed: "service", // 17 · The library's commands
  capability_a19bf216935b: "index", // 21 · Links
  capability_b7a12a2b7273: "log", // 22 · Decision log
  capability_36bcae448803: "index", // 23 · Catalogue
  capability_53fd994f7b4c: "log", // 24 · Graduation
  capability_d8451645c169: "queue", // 25 · Lapsed questions
  capability_389fd5e3722d: "queue", // 26 · Rounds
  capability_73c014cf4352: "service", // 27 · Fixed data questions
};

/** The kind a capability's settlement is drawn as. */
export const kindOf = (capability: string): Kind => LIBRARY_KINDS[capability] ?? "service";

const rect = (l: number, t: number, r: number, b: number): G[] => [[l, t], [r, t], [r, b], [l, b]];
/** Points along an ellipse round (cx, cy) from angle `from` to `to` (radians, y down), both ends included. */
const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, n = 12): G[] =>
  Array.from({ length: n + 1 }, (_, k) => { const t = from + (to - from) * k / n; return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as const; });
/** Points along a quadratic curve from `a` by control `c` to `b`, `a` left out. */
const curve = (a: G, c: G, b: G, n = 8): G[] =>
  Array.from({ length: n }, (_, k) => { const t = (k + 1) / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as const; });

/** Each kind's symbol (the mock's GLYPHS): `parts` closed shapes, each filled then outlined, in order; `lines` drawn over them. */
export const GLYPHS: Readonly<Record<Kind, { readonly parts: readonly (readonly G[])[]; readonly lines: readonly (readonly G[])[] }>> = {
  // A database: the cylinder, with one band.
  store: { parts: [[...arc(0, -6.5, 8, 3, Math.PI, 2 * Math.PI), ...arc(0, 6.5, 8, 3, 0, Math.PI)]], lines: [arc(0, -6.5, 8, 3, Math.PI, 0), arc(0, 0, 8, 3, Math.PI, 0)] },
  // A service: the component box, two tabs on its side.
  service: { parts: [rect(-6, -8, 9, 8), rect(-10, -5, -2, -1.5), rect(-10, 1.5, -2, 5)], lines: [] },
  // A queue: a row of cells.
  queue: { parts: [rect(-10.5, -5, 10.5, 5)], lines: [[[-5.25, -5], [-5.25, 5]], [[0, -5], [0, 5]], [[5.25, -5], [5.25, 5]]] },
  // An index: the lens.
  index: { parts: [arc(-2, -2, 6, 6, 0, 2 * Math.PI, 24).slice(0, -1)], lines: [[[2.3, 2.3], [9, 9]]] },
  // A connection: the plug.
  link: { parts: [[[-6.5, -3], [6.5, -3], [6.5, 2], ...curve([6.5, 2], [6.5, 7.5], [0, 7.5]), ...curve([0, 7.5], [-6.5, 7.5], [-6.5, 2]).slice(0, -1)]], lines: [[[-3, -3], [-3, -9]], [[3, -3], [3, -9]], [[0, 7.5], [0, 11]]] },
  // A record or log: a page in front of another, its corner folded.
  log: { parts: [rect(-4, -10, 9, 6), [[-9, -6], [3, -6], [7, -2], [7, 10], [-9, 10]]], lines: [[[3, -6], [3, -2], [7, -2]], [[-6, 1], [4, 1]], [[-6, 5], [4, 5]]] },
};

/** Triangles (x, y pairs, three to a triangle) stroking `pts` `width` wide: a quad per step and a round join at each point. */
function stroke(pts: readonly G[], width: number, closed: boolean): G[] {
  const out: G[] = [], h = width / 2, ends = closed ? [...pts, pts[0]!] : pts;
  for (let i = 0; i + 1 < ends.length; i++) {
    const [ax, ay] = ends[i]!, [bx, by] = ends[i + 1]!, l = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / l * h, ny = (bx - ax) / l * h;
    out.push([ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax + nx, ay + ny], [bx - nx, by - ny], [ax - nx, ay - ny]);
  }
  for (const [x, y] of pts) for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, b = (k + 1) * Math.PI / 4;
    out.push([x, y], [x + h * Math.cos(a), y + h * Math.sin(a)], [x + h * Math.cos(b), y + h * Math.sin(b)]);
  }
  return out;
}

/** Triangles filling the closed shape `pts`. */
function fill(pts: readonly G[]): G[] {
  return ShapeUtils.triangulateShape(pts.map(([x, y]) => new Vector2(x, y)), []).flatMap((t) => t.map((i) => pts[i]!));
}

/**
 * The settlements of `roads`, each its capability's kind's symbol laid flat on the land by `onSurface`, `lift` above it,
 * its 24-unit box as large as the settlement's `size`.
 */
export function settlementSymbols(roads: IslandRoads, onSurface: (p: Point) => Vector3, lift: number): Group {
  const group = new Group();
  group.name = "settlements";
  const flat = (colour: string, opacity = 1) => new MeshBasicMaterial({ color: colour, transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthWrite: false });
  const paper = flat(SYMBOL_INK.paper), ink = flat(SYMBOL_INK.ink);
  // The casing writes depth and draws only nearer than what is there, so where its strokes overlap it is laid once, not darker.
  const casing = new MeshBasicMaterial({ color: new Color(SYMBOL_INK.casing), transparent: true, opacity: SYMBOL_INK.casingOpacity, side: DoubleSide, forceSinglePass: true, depthFunc: LessDepth });
  for (const [capability, { at, size, roads: meeting }] of roads.settlements) {
    const kind = kindOf(capability), glyph = GLYPHS[kind], k = size / 24;
    const symbol = new Group();
    symbol.name = `settlement:${capability}`;
    symbol.userData = { settlement: true, capability, kind, size, roads: meeting };
    let layer = 0;
    const add = (triangles: readonly G[], material: MeshBasicMaterial, name: string) => {
      const up = lift * (1 + layer * 0.05), positions: number[] = [];
      for (const [x, y] of triangles) { const v = onSurface({ x: at.x + x * k, z: at.z + y * k }); positions.push(v.x, v.y + up, v.z); }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      mesh.renderOrder = 6 + layer++ * 0.01;
      mesh.raycast = () => {};
      symbol.add(mesh);
    };
    add([...glyph.parts, ...glyph.lines].flatMap((pts, i) => stroke(pts, WIDTH + CASING, i < glyph.parts.length)), casing, "settlement-casing");
    glyph.parts.forEach((pts, i) => { add(fill(pts), paper, `settlement-paper:${i}`); add(stroke(pts, WIDTH, true), ink, `settlement-ink:${i}`); });
    if (glyph.lines.length) add(glyph.lines.flatMap((pts) => stroke(pts, WIDTH, false)), ink, "settlement-lines");
    group.add(symbol);
  }
  return group;
}
