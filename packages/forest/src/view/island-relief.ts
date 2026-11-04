/**
 * Capability 3 · Story node render: the selected island's relief as drawn (ADR-1236 D1, rollout 2 step 3b), round 11's
 * look: a wall where a plateau stands over the open land or the coast, shaded by the light, with a soft shadow on the
 * open land where it faces away; a ramp at each gate onto the open land, its slope and two cheeks; and a bevel rim inside
 * each border, light where it faces the light and dark where it faces away. Each mark takes its colour from the land it
 * stands on. Plain three.js, so the marks are read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, MeshBasicMaterial, type Side, Vector3 } from "three";
import { LIGHT, type IslandRelief } from "../territories/island-relief.js";
import type { Point } from "../territories/territories.js";
import { landColour, shade, type FillAt } from "./island-roads.js";

/** A wall's shadow: its darkness, reach and feather; a rim's light and dark, and how far in it holds its edge's colour. */
const SHADE = { shadow: { alpha: 0.3, reach: 1.0, feather: 0.9 }, rim: { light: 0.45, dark: 0.36, hold: 0.45 } } as const;

const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });

/** The relief of the selected island, each ground point placed on its surface by `onGround` (the open land's height). */
export function islandReliefMarks(relief: IslandRelief, onGround: (p: Point) => Vector3, fillAt: FillAt): Group {
  const group = new Group();
  group.name = "island-relief";
  const under = landColour(fillAt), H = relief.height, S = relief.scale;
  const black = new Color("#000"), white = new Color("#fff");
  const up = (p: Point, k: number) => { const v = onGround(p); v.y += k; return v; };
  const solid = (name: string, order: number, side: Side = DoubleSide) => {
    const positions: number[] = [], colours: number[] = [];
    const tri = (a: Vector3, b: Vector3, c: Vector3, ca: Color, cb = ca, cc = ca) => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      colours.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
    };
    /** A quad a-b-c-d; with `facing`, wound so its front faces that way on the ground (a wall seen from outside). */
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, ca: Color, cb = ca, cc = cb, cd = ca, facing?: Point) => {
      if (facing !== undefined) {
        const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
        if (n.x * facing.x + n.z * facing.z < 0) { tri(a, c, b, ca, cc, cb); tri(a, d, c, ca, cd, cc); return; }
      }
      tri(a, b, c, ca, cb, cc); tri(a, c, d, ca, cc, cd);
    };
    const done = (userData: Record<string, unknown>) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side, forceSinglePass: true, depthWrite: false }));
      mesh.name = name;
      mesh.renderOrder = order;
      mesh.raycast = () => {};
      mesh.userData = userData;
      group.add(mesh);
    };
    return { tri, quad, done };
  };

  // Walls, each shaded by where it faces, and on the open land a soft shadow where it faces away from the light.
  const walls = solid("relief-walls", 0.7, FrontSide), shadows = solid("relief-shadows", 0.6);
  for (const w of relief.walls) {
    const mid = { x: (w.from.x + w.to.x) / 2, z: (w.from.z + w.to.z) / 2 }, face = shade(under(at(mid, w.out, -0.5 * S)), w.out);
    walls.quad(up(w.from, H), up(w.to, H), up(w.to, -0.05 * S), up(w.from, -0.05 * S), face, face, face, face, w.out);
    const k = -dot(w.out, LIGHT);
    if (w.onto === "open" && k > 0) {
      const A = SHADE.shadow.alpha * Math.sqrt(k), r1 = SHADE.shadow.reach * Math.sqrt(k) * S, r2 = r1 + SHADE.shadow.feather * S;
      const ground = under(at(mid, w.out, r2)), g0 = ground.clone().lerp(black, A), g1 = ground.clone().lerp(black, A * 0.85);
      const v = (q: Point) => up(q, 0.02 * S);
      shadows.quad(v(w.from), v(w.to), v(at(w.to, w.out, r1)), v(at(w.from, w.out, r1)), g0, g0, g1, g1);
      shadows.quad(v(at(w.from, w.out, r1)), v(at(w.to, w.out, r1)), v(at(w.to, w.out, r2)), v(at(w.from, w.out, r2)), g1, g1, ground, ground);
    }
  }
  walls.done({ walls: relief.walls.length });
  shadows.done({});

  // Ramps: a slope from the open land up to the plateau, its two cheeks first so the slope covers the far one.
  const cheeks = solid("relief-ramp-cheeks", 0.8), slopes = solid("relief-ramps", 0.9);
  for (const r of relief.ramps) {
    const fill = under(at(r.at, r.out, -0.8 * S)), w = relief.rampWidth / 2, d = relief.rampDepth;
    const e1 = at(r.at, r.along, -w), e2 = at(r.at, r.along, w), f1 = at(e1, r.out, d), f2 = at(e2, r.out, d);
    const top = (q: Point) => up(q, H), low = (q: Point) => up(q, 0.01 * S);
    cheeks.tri(top(e1), low(e1), low(f1), shade(fill, { x: -r.along.x, z: -r.along.z }));
    cheeks.tri(top(e2), low(e2), low(f2), shade(fill, r.along));
    const slope = fill.clone().multiplyScalar(0.9 + 0.08 * dot(r.out, LIGHT));
    slopes.quad(top(e1), top(e2), low(f2), low(f1), fill, fill, slope, slope);
  }
  cheeks.done({});
  slopes.done({ ramps: relief.ramps.length });

  // Bevel rims: inside each border, on each territory's side, light where it faces the light, dark where it faces away.
  const rims = solid("relief-rims", 1.6), hold = relief.rimWidth * SHADE.rim.hold;
  for (const r of relief.rims) {
    const mid = { x: (r.from.x + r.to.x) / 2, z: (r.from.z + r.to.z) / 2 }, fill = under(at(mid, r.into, 0.4 * S));
    const k = -dot(r.into, LIGHT), edge = fill.clone().lerp(k > 0 ? white : black, (k > 0 ? SHADE.rim.light : SHADE.rim.dark) * Math.sqrt(Math.abs(k)));
    const between = fill.clone().lerp(edge, 0.85), v = (q: Point) => up(q, H + 0.06 * S);
    rims.quad(v(r.from), v(r.to), v(at(r.to, r.into, hold)), v(at(r.from, r.into, hold)), edge, edge, between, between);
    rims.quad(v(at(r.from, r.into, hold)), v(at(r.to, r.into, hold)), v(at(r.to, r.into, relief.rimWidth)), v(at(r.from, r.into, relief.rimWidth)), between, between, fill, fill);
  }
  rims.done({ rims: relief.rims.length });
  return group;
}
