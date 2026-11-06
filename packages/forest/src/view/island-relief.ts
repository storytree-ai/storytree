/**
 * Capability 3 · Story node render: each island's relief as drawn (ADR-1236 D1 as narrowed by ADR-1253 D2, rollout 2 step 3b), round 11's
 * look: a wall where a plateau stands over the open land or the coast, shaded by the light, with a soft shadow on the
 * open land where it faces away; a ramp at each gate onto the open land, its slope and two cheeks; and a bevel rim inside
 * each border, light where it faces the light and dark where it faces away; and over each tunnel its low rise, its slopes
 * lit toward the light and shaded away (question_921aee319481). Each mark takes its colour from the land it stands on. Plain three.js, so the marks are read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FrontSide, Group, Mesh, MeshBasicMaterial, type Side, Vector3 } from "three";
import { LIGHT, type IslandRelief } from "../territories/island-relief.js";
import type { Point } from "../territories/territories.js";
import { landColour, shade, type FillAt } from "./island-roads.js";

/** A wall's shadow: its darkness, reach and feather; a rim's light and dark, and how far in it holds its edge's colour. */
const SHADE = { shadow: { alpha: 0.3, reach: 1.0, feather: 0.9 }, rim: { light: 0.45, dark: 0.36, hold: 0.45 } } as const;
/** A tunnel's rise: the light's height over the ground, how strongly a slope's turn to it lightens or darkens the land, the
 * lightening of its crest and darkening of its foot, the shadow it casts on the land away from the light (its darkness, and its reach by the rise's
 * height), how fast it fades in
 * from the land round it by its height, and the grid it is drawn on, in The library's units. */
const RISE_SHADE = { lightUp: 1.3, strength: 1.8, most: 0.5, crest: 0.22, foot: 0.08, shadow: 0.2, reach: 0.6, fade: 2, step: 0.14 } as const;

const dot = (a: Point, b: Point) => a.x * b.x + a.z * b.z;
const at = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, z: p.z + d.z * k });

/** The relief of an island, each ground point placed on its surface by `onGround` (the open land's height). */
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

  // Each tunnel's rise: the land over its way drawn on a fine grid at its height, each point shaded by its slope's turn to the
  // light and by the rise's shadow, and fading out where it meets the land round it, so the rims and coast there show through;
  // just over the plateau, as the rims are, so the two never fight for one depth.
  const step = RISE_SHADE.step * S, reach = RISE_SHADE.reach * relief.rise.height, r = relief.rise.halfWidth + relief.rise.inset + reach;
  const light = new Vector3(LIGHT.x, RISE_SHADE.lightUp, LIGHT.z).normalize(), flatLit = light.y, n = new Vector3();
  const positions: number[] = [], colours: number[] = [];
  for (const t of relief.tunnels) {
    // The rise's height at every point of a grid round the tunnel, read once; slopes and shadows are read off the grid, and
    // whether a point is on the plateau only where something is drawn.
    const xs = t.pts.map((q) => q.x), zs = t.pts.map((q) => q.z), x0 = Math.min(...xs) - r, z0 = Math.min(...zs) - r;
    const nx = Math.ceil((Math.max(...xs) + r - x0) / step), nz = Math.ceil((Math.max(...zs) + r - z0) / step);
    const bump = Array.from({ length: nx + 1 }, (_, i) => Float64Array.from({ length: nz + 1 }, (_, j) => relief.riseAt({ x: x0 + i * step, z: z0 + j * step })));
    const height = (x: number, z: number) => {
      const u = Math.max(0, Math.min(nx - 1e-9, (x - x0) / step)), w = Math.max(0, Math.min(nz - 1e-9, (z - z0) / step)), i = Math.floor(u), j = Math.floor(w), fu = u - i, fw = w - j;
      return (bump[i]![j]! * (1 - fu) + bump[i + 1]![j]! * fu) * (1 - fw) + (bump[i]![j + 1]! * (1 - fu) + bump[i + 1]![j + 1]! * fu) * fw;
    };
    const shadowed = Array.from({ length: nx + 1 }, (_, i) => Float64Array.from({ length: nz + 1 }, (_, j) => {
      const q = { x: x0 + i * step, z: z0 + j * step }, here = bump[i]![j]!;
      // Shadowed where the rise toward the light stands over this point, softened by looking twice.
      return Math.max(0, Math.min(1, [0.5, 1].reduce((sum, k) => sum + (height(q.x + LIGHT.x * reach * k, q.z + LIGHT.z * reach * k) - here) / 2, 0) / relief.rise.height));
    }));
    const alphaAt = (i: number, j: number) => Math.min(1, Math.max(shadowed[i]![j]!, bump[i]![j]! / relief.rise.height) * RISE_SHADE.fade);
    // 0 not yet read, 1 on the plateau, 2 off it.
    const plateau = new Uint8Array((nx + 1) * (nz + 1));
    const onPlateau = (i: number, j: number) => {
      const key = i * (nz + 1) + j;
      if (plateau[key] === 0) { const t = relief.territoryAt({ x: x0 + i * step, z: z0 + j * step }); plateau[key] = t !== undefined && t >= 0 ? 1 : 2; }
      return plateau[key] === 1;
    };
    const drawn: ({ v: Vector3; colour: Color; alpha: number } | undefined)[] = [];
    const point = (i: number, j: number) => {
      const key = i * (nz + 1) + j, known = drawn[key];
      if (known !== undefined) return known;
      const q = { x: x0 + i * step, z: z0 + j * step }, here = H + bump[i]![j]!;
      const slope = (a: number, b: number, d: number) => (a - b) / (d * step);
      n.set(-slope(bump[Math.min(i + 1, nx)]![j]!, bump[Math.max(i - 1, 0)]![j]!, Math.min(i + 1, nx) - Math.max(i - 1, 0)), 1, -slope(bump[i]![Math.min(j + 1, nz)]!, bump[i]![Math.max(j - 1, 0)]!, Math.min(j + 1, nz) - Math.max(j - 1, 0))).normalize();
      const k = (n.dot(light) - flatLit) * RISE_SHADE.strength, c = under(q);
      const lit = k > 0 ? c.lerp(white, Math.min(RISE_SHADE.most, k)) : c.lerp(black, Math.min(RISE_SHADE.most, -k));
      // Its crest a little lighter, so its top reads as a ridge, and its foot a little darker all round, so its edge holds.
      const up01 = Math.max(0, (here - H) / relief.rise.height);
      lit.lerp(white, RISE_SHADE.crest * up01 ** 3);
      if (up01 > 0) lit.lerp(black, RISE_SHADE.foot * (1 - up01) ** 3);
      const made = { v: up(q, here + 0.04 * S), colour: lit.lerp(black, RISE_SHADE.shadow * shadowed[i]![j]!), alpha: alphaAt(i, j) };
      drawn[key] = made;
      return made;
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const ids = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
      if (ids.every(([a, b]) => alphaAt(a, b) === 0) || !ids.every(([a, b]) => onPlateau(a, b))) continue;
      // Split along the diagonal the land (or, at its foot, the fade) changes least across, so its crest and its edge run
      // smooth rather than in steps.
      const across = (a: readonly [number, number], b: readonly [number, number]) => Math.abs(bump[a[0]]![a[1]]! - bump[b[0]]![b[1]]!) + 1e-3 * Math.abs(alphaAt(...a) - alphaAt(...b));
      const split = across(ids[0], ids[2]) <= across(ids[1], ids[3]) ? [0, 1, 2, 0, 2, 3] : [0, 1, 3, 1, 2, 3];
      for (const k of split) { const c = point(...ids[k]!); positions.push(c.v.x, c.v.y, c.v.z); colours.push(c.colour.r, c.colour.g, c.colour.b, c.alpha); }
    }
  }
  if (positions.length > 0) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colours, 4));
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, side: DoubleSide, forceSinglePass: true, depthWrite: false }));
    mesh.name = "relief-rise";
    // Drawn under the rims and borders, so they run on over its foot.
    mesh.renderOrder = 1.5;
    mesh.raycast = () => {};
    mesh.userData = { tunnels: relief.tunnels.length };
    group.add(mesh);
  }
  return group;
}
