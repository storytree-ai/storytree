/**
 * Capability 5 · Agent capability claims: the world's claim mark is a flag (ADR-0968). Each capability a running session
 * claims carries one pennant in that session's colour on a dark pole, standing at a point inside its territory, its size
 * constant on screen and its pole upright; where an island is too small to carry a pennant it is a dot. It drops in with
 * one ring at its foot, stands still while held, furls and greys when its holder goes quiet, and lifts away when the claim
 * goes. On an island with no code yet the claimed share is marked as a lot, a dashed white line inside its border.
 * Each claim is a group named `territory-claim:<capability>` carrying `userData { claim, capability, colour, faded }`,
 * the handle the capture seam, the visibility switch and the tests read. Plain three.js, so it is read without a browser.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type Material, type Object3D } from "three";
import type { ClaimTint } from "@storytree/forest";
import { facing } from "./nameplates.js";
import { lotDashes, type DrawnLand } from "./territory-land.js";

type Point = { readonly x: number; readonly z: number };
type Claimed = ReadonlyMap<string, ClaimTint>;

const INK = "#0d1114";
const SHADOW = { colour: "#080b0e", opacity: 0.45 };
const LOT = { colour: "#f4f7f8", opacity: 0.72 };
/**
 * One unit of the mock-up the flag was drawn in, in ground units: today's band of 1.2 ground units was 0.6 of one on the
 * website's capture (ADR-0968's increment, "Units"). An island of the size the drawn sizes were judged on spans about 44.
 */
const MOCK_UNIT = 2;
const ISLAND_WIDTH = 44;
/** The lot's line: this far inside the share's border, in dashes this long and this far apart, in mock units. */
const LOT_INSET = 0.5, LOT_ON = 0.75, LOT_OFF = 0.6;
/** Lifted just above the territories (`TERRITORY_LIFT`) so the lot lies on them. */
const LOT_LIFT = 0.06;
/** Drawn after the land, the borders and the file circles, and never hidden by the ground it stands on. */
const FLAG_ORDER = 6;

/** The flag's scale `k` for islands `islandPx` wide on screen, fitted to the three drawn sizes (90, 200 and 480 px wide: 0.6, 0.9, 1.3), and a dot at about 45 px or less. */
export function flagScale(islandPx: number): { k: number; dot: boolean } {
  const anchors = [[90, 0.6], [200, 0.9], [480, 1.3]] as const;
  const [[x0, y0], [x1, y1]] = islandPx <= 200 ? [anchors[0], anchors[1]] : [anchors[1], anchors[2]];
  const k = y0 + (y1 - y0) * (Math.log(Math.max(islandPx, 1)) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
  return { k: Math.min(1.6, Math.max(0.4, k)), dot: islandPx <= 45 };
}

/** A claim's quiet turning: from `from` to `to` (0 held, 1 quiet), starting at `at` seconds. */
export type QuietTurn = { from: number; to: number; at: number };

const easeBack = (t: number) => { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/**
 * Where a claim's life stands at `now` (seconds), for a claim that `arrived` then (absent: it was standing when the globe
 * first drew) and was `left` then (absent: still held). `lift` is in px at k = 1, up on screen; `ring` is the arrival
 * ring's progress, absent when none shows; `lot` the lot's strength; `live` whether a transition still wants frames.
 * Reduced motion jumps every transition to its end (ADR-0968 D2).
 */
export function claimMoment({ arrived, left, quiet, now, reduced }: { arrived?: number | undefined; left?: number | undefined; quiet: QuietTurn; now: number; reduced: boolean }) {
  const a = reduced || arrived === undefined ? 1 : clamp01((now - arrived) / 1.2);
  const out = left === undefined ? 0 : reduced ? 1 : clamp01((now - left) / 0.8);
  const turned = reduced ? 1 : clamp01((now - quiet.at) / 0.8);
  const eased = turned < 0.5 ? 4 * turned ** 3 : 1 - (-2 * turned + 2) ** 3 / 2;
  const p = (a - 0.4) / 0.6;
  return {
    lift: 20 * (1 - easeBack(Math.min(1, a / 0.55))) + 15 * out ** 3 + 0,
    opacity: Math.min(1, a / 0.2) * (1 - out),
    quiet: quiet.from + (quiet.to - quiet.from) * eased,
    ring: p > 0 && p < 1 ? p : undefined,
    lot: Math.min(1, a / 0.5) * (1 - out),
    live: a < 1 || (left !== undefined && out < 1) || turned < 1,
  };
}

/** The session's colour, greyed by `q` (0 held, 1 quiet): a third less saturated and four points darker. */
function greyed(colour: string, q: number): Color {
  if (q === 0) return new Color(colour);
  const hsl = new Color(colour).getHSL({ h: 0, s: 0, l: 0 });
  return new Color().setHSL(hsl.h, hsl.s * (1 - q / 3), Math.max(0, hsl.l - 0.04 * q));
}

const flatMaterial = (colour: Color | string, opacity = 1) =>
  new MeshBasicMaterial({ color: new Color(colour), transparent: true, opacity, side: DoubleSide, forceSinglePass: true, depthTest: false, depthWrite: false });

/** Triangles from flat [x, y] corners, in the flag's own screen frame (px, y up). */
function triangles(corners: readonly (readonly [number, number])[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(corners.flatMap(([x, y]) => [x, y, 0]), 3));
  return geometry;
}
const disc = (cx: number, cy: number, rx: number, ry = rx, sides = 16): [number, number][] =>
  Array.from({ length: sides }, (_, i) => [i, i + 1]).flatMap(([i, j]) => [[cx, cy], [cx + rx * Math.cos(2 * Math.PI * i! / sides), cy + ry * Math.sin(2 * Math.PI * i! / sides)], [cx + rx * Math.cos(2 * Math.PI * j! / sides), cy + ry * Math.sin(2 * Math.PI * j! / sides)]] as [number, number][]);
/** A line `width` wide through `points`, with round joins and caps. */
function stroke(points: readonly (readonly [number, number])[], width: number, closed = false): [number, number][] {
  const h = width / 2;
  const runs = closed ? points.map((p, i) => [p, points[(i + 1) % points.length]!] as const) : points.slice(1).map((p, i) => [points[i]!, p] as const);
  return [...runs.flatMap(([[ax, ay], [bx, by]]): [number, number][] => {
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / length * h, (bx - ax) / length * h];
    return [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax + nx, ay + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
  }), ...points.flatMap(([x, y]) => disc(x, y, h, h, 8))];
}
const quadratic = (from: readonly [number, number], via: readonly [number, number], to: readonly [number, number], steps = 10) =>
  Array.from({ length: steps + 1 }, (_, i): [number, number] => { const t = i / steps, u = 1 - t; return [u * u * from[0] + 2 * u * t * via[0] + t * t * to[0], u * u * from[1] + 2 * u * t * via[1] + t * t * to[1]]; });

/** The pennant's outline at scale `k`, furled by `q`: from the pole's top out to its tip and back, its edges bowed (ADR-0968's reference drawing). */
function pennantOutline(k: number, q: number): [number, number][] {
  const H = 26 * k, W = 17 * k * (1 - 0.58 * q), h = 12 * k, droop = q * 9 * k;
  // The drawing's y runs down the canvas; here it runs up the screen.
  const tip: [number, number] = [W, H - h * 0.5 - droop];
  return [...quadratic([0.6 * k, H], [W * 0.5, H - h * 0.16 - droop * 0.4], tip), ...quadratic(tip, [W * 0.5, H - h * 0.84 - droop * 0.8], [0.6 * k, H - h - droop * 0.25]).slice(1)];
}

/** The flag's own marks at scale `k`, furled by `q`, replacing what `drawing` held: a pennant on a pole over a shadow, or a dot. */
function drawFlag(drawing: Group, colour: string, k: number, q: number): void {
  for (const child of [...drawing.children]) { child.removeFromParent(); disposeMark(child); }
  const fill = greyed(colour, q);
  const outline = pennantOutline(k, q);
  const mark = (name: string, geometry: BufferGeometry, material: MeshBasicMaterial, order: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.raycast = () => {};
    mesh.renderOrder = FLAG_ORDER + order;
    drawing.add(mesh);
    return mesh;
  };
  const pole = Math.max(1.5, 2.2 * k);
  mark("flag-shadow", triangles(disc(0, 0, 4.4 * k, 2 * k)), flatMaterial(SHADOW.colour, SHADOW.opacity), 0);
  mark("flag-pennant", triangles(outline.slice(1).flatMap((p, i) => [outline[0]!, outline[i]!, p])), flatMaterial(fill), 0.1);
  mark("flag-outline", triangles(stroke(outline, Math.max(1, 1.1 * k), true)), flatMaterial(INK), 0.2);
  mark("flag-pole", triangles(stroke([[0, 0], [0, 26 * k]], pole)), flatMaterial(INK), 0.3);
  // Too small for a pennant: a dot in the session's colour inside a dark ring, its middle dark once quiet.
  const dot = new Group();
  dot.name = "flag-dot";
  dot.visible = false;
  for (const [name, geometry, material] of [
    ["flag-dot-ring", triangles(disc(0, 0, 2.4 + 1.1, 2.4 + 1.1, 20)), flatMaterial(INK)],
    ["flag-dot-fill", triangles(disc(0, 0, 2.4, 2.4, 20)), flatMaterial(fill)],
    ["flag-dot-quiet", triangles(disc(0, 0, 1.2, 1.2, 12)), flatMaterial(INK, q)],
  ] as const) {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.raycast = () => {};
    mesh.renderOrder = FLAG_ORDER + 0.4;
    dot.add(mesh);
  }
  drawing.add(dot);
}

function disposeMark(root: Object3D): void {
  root.traverse((object) => {
    const mark = object as { geometry?: BufferGeometry; material?: Material };
    mark.geometry?.dispose();
    mark.material?.dispose();
  });
}

/** Where a claimed capability's flag stands: the seed of its territory's cell nearest the middle of its cells' seeds, the point its nameplate uses (`capabilityPlates`). */
function footOf(map: ClaimLand, at: number): Point | undefined {
  const sites = map.cells.filter((cell) => cell.territory === at).map((cell) => cell.site);
  if (sites.length === 0) return undefined;
  const middle = { x: sites.reduce((s, p) => s + p.x, 0) / sites.length, z: sites.reduce((s, p) => s + p.z, 0) / sites.length };
  return sites.reduce((best, p) => Math.hypot(p.x - middle.x, p.z - middle.z) < Math.hypot(best.x - middle.x, best.z - middle.z) ? p : best);
}

/** An island's territories as cut, each cell with its seed. */
export type ClaimLand = Omit<DrawnLand, "cells"> & { readonly cells: readonly { readonly site: Point; readonly polygon: readonly Point[]; readonly territory: number }[] };

type Life = { colour: string; faded: boolean; arrived?: number; left?: number; quiet: QuietTurn; drawn?: string };

/**
 * An island's claim marks, kept across changes of its claims so each can play its life: `claims` says who holds what now,
 * `frame` poses every mark for the eye and the moment and says whether it wants another frame. `root` goes on the plate.
 */
export class ClaimMarks {
  readonly root = new Group();
  private land: { map: ClaimLand; onSurface: (point: Point) => Vector3; normalAt: (point: Point) => Vector3; unsurveyed: boolean; coast?: readonly (readonly Point[])[] | undefined } | undefined;
  private readonly lives = new Map<string, Life>();
  private readonly turned = new Quaternion();

  constructor() {
    this.root.name = "claim-marks";
  }

  /** The island's land the marks stand on; `unsurveyed` when it has no surveyed code, so a claimed share is a lot. */
  setLand(map: ClaimLand, onSurface: (point: Point) => Vector3, normalAt: (point: Point) => Vector3, unsurveyed: boolean, coast?: readonly (readonly Point[])[]): void {
    this.land = { map, onSurface, normalAt, unsurveyed, coast };
    for (const [capability, life] of this.lives) this.remove(capability, life, false);
  }

  /** The claims held now, at `now` seconds. A new one arrives, unless `standing` (the globe's first drawing); one gone lifts away. */
  claims(claimed: Claimed, now: number, { standing, reduced }: { standing: boolean; reduced: boolean }): void {
    for (const [capability, tint] of claimed) {
      const life = this.lives.get(capability);
      if (life === undefined || life.left !== undefined) {
        this.lives.set(capability, { colour: tint.colour, faded: tint.faded, ...(standing || reduced ? {} : { arrived: now }), quiet: { from: tint.faded ? 1 : 0, to: tint.faded ? 1 : 0, at: now } });
        if (life !== undefined) this.remove(capability, life, false);
        continue;
      }
      if (life.faded !== tint.faded) {
        const q = claimMoment({ quiet: life.quiet, now, reduced }).quiet;
        life.quiet = { from: q, to: tint.faded ? 1 : 0, at: now };
      }
      life.colour = tint.colour;
      life.faded = tint.faded;
    }
    for (const [capability, life] of this.lives) if (!claimed.has(capability) && life.left === undefined) life.left = now;
  }

  /** Poses every mark at `now` for an eye at `zoom` (CSS px per world unit) turned by `eye`; true while a transition still wants frames. */
  frame(now: number, { zoom, eye, reduced }: { zoom: number; eye: Quaternion; reduced: boolean }): boolean {
    const { k, dot } = flagScale(zoom * ISLAND_WIDTH);
    let live = false;
    for (const [capability, life] of [...this.lives]) {
      const moment = claimMoment({ arrived: life.arrived, left: life.left, quiet: life.quiet, now, reduced });
      if (life.left !== undefined && moment.opacity <= 0) {
        this.remove(capability, life, true);
        continue;
      }
      live ||= moment.live;
      const mark = this.markOf(capability, life);
      if (mark === undefined) continue;
      mark.userData = { claim: true, capability, colour: life.colour, faded: life.faded };
      const flag = mark.getObjectByName("claim-flag") as Group;
      const drawing = flag.getObjectByName("flag-drawing") as Group;
      // One drawing per size and furl, so a standing flag is drawn once.
      const key = `${life.colour}|${Math.round(k * 20)}|${Math.round(moment.quiet * 50)}`;
      if (life.drawn !== key) { drawFlag(drawing, life.colour, Math.round(k * 20) / 20, Math.round(moment.quiet * 50) / 50); life.drawn = key; }
      const drawnK = Math.round(k * 20) / 20;
      // Upright and constant on screen: turned to the eye, one world unit a CSS pixel.
      flag.parent!.updateWorldMatrix(true, false);
      flag.parent!.getWorldQuaternion(this.turned);
      // It hides with its island once the island turns away.
      flag.visible = facing(this.turned, eye) > 0;
      flag.quaternion.copy(this.turned.invert().multiply(eye));
      const plateScale = new Vector3().setFromMatrixScale(flag.parent!.matrixWorld).x || 1;
      flag.scale.setScalar(dot ? 1 / zoom / plateScale : k / drawnK / zoom / plateScale);
      drawing.position.y = dot ? 0 : moment.lift * drawnK;
      for (const child of drawing.children) child.visible = (child.name === "flag-dot") === dot;
      drawing.traverse((object) => {
        const material = (object as Mesh).material as MeshBasicMaterial | undefined;
        if (material === undefined) return;
        material.userData.full ??= material.opacity;
        material.opacity = (object.name === "flag-dot-quiet" ? moment.quiet : material.userData.full) * moment.opacity;
      });
      const ring = mark.getObjectByName("claim-ring") as Mesh;
      ring.visible = moment.ring !== undefined;
      if (moment.ring !== undefined) {
        const inner = 3 / zoom + easeOutCubic(moment.ring) * 2.1 * MOCK_UNIT;
        ring.geometry.dispose();
        ring.geometry = new RingGeometry(inner, inner + 1.6 / zoom, 48);
        (ring.material as MeshBasicMaterial).opacity = 0.85 * (1 - moment.ring);
      }
      const lot = mark.getObjectByName(`claim-lot:${capability}`) as LineSegments | undefined;
      if (lot !== undefined) (lot.material as LineBasicMaterial).opacity = LOT.opacity * moment.lot;
    }
    return live;
  }

  dispose(): void {
    for (const [capability, life] of [...this.lives]) this.remove(capability, life, true);
  }

  /** The marks of a claim, made on first need; none when its capability has no ground here. */
  private markOf(capability: string, life: Life): Group | undefined {
    const existing = this.root.getObjectByName(`territory-claim:${capability}`) as Group | undefined;
    if (existing !== undefined || this.land === undefined) return existing;
    const { map, onSurface, normalAt, unsurveyed, coast } = this.land;
    const at = map.territories.findIndex((territory) => territory.capability === capability);
    const foot = at < 0 ? undefined : footOf(map, at);
    if (foot === undefined) return undefined;
    const mark = new Group();
    mark.name = `territory-claim:${capability}`;
    const flag = new Group();
    flag.name = "claim-flag";
    flag.position.copy(onSurface(foot));
    const drawing = new Group();
    drawing.name = "flag-drawing";
    flag.add(drawing);
    const ring = new Mesh(new RingGeometry(1, 1.1, 8), flatMaterial(life.colour, 0));
    ring.name = "claim-ring";
    ring.raycast = () => {};
    ring.renderOrder = FLAG_ORDER - 0.5;
    ring.position.copy(onSurface(foot));
    ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normalAt(foot));
    ring.visible = false;
    mark.add(ring, flag);
    if (unsurveyed) {
      const dashes = lotDashes(map, at, coast, { inset: LOT_INSET * MOCK_UNIT, on: LOT_ON * MOCK_UNIT, off: LOT_OFF * MOCK_UNIT });
      const lifted = (p: Point) => onSurface(p).addScaledVector(normalAt(p), LOT_LIFT);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(dashes.flatMap(({ from, to }) => [lifted(from), lifted(to)]).flatMap((p) => [p.x, p.y, p.z]), 3));
      const lot = new LineSegments(geometry, new LineBasicMaterial({ color: LOT.colour, transparent: true, opacity: 0, depthWrite: false }));
      lot.name = `claim-lot:${capability}`;
      lot.raycast = () => {};
      lot.renderOrder = 2.6;
      mark.add(lot);
    }
    this.root.add(mark);
    return mark;
  }

  private remove(capability: string, life: Life, forget: boolean): void {
    const mark = this.root.getObjectByName(`territory-claim:${capability}`);
    if (mark !== undefined) { mark.removeFromParent(); disposeMark(mark); }
    delete life.drawn;
    if (forget) this.lives.delete(capability);
  }
}
