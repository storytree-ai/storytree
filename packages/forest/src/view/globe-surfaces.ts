/** Capability 3 · Story node render. */
import type { BufferAttribute, Color, Group, LineSegments, Mesh, MeshBasicMaterial, Object3D } from "three";
import { filledUnder } from "./territory-land.js";
import type { Detail } from "./zoom-detail.js";

/** The app's attention switches, also available to guides mounted outside the app. */
export type GlobeSurfaces = {
  grounds: boolean; roads: boolean; nameplates: boolean;
  territories: false | "plain" | "health";
  knowledgeCore: boolean; sessionTints: boolean;
};

/** The ordinary Forest view. */
const FOREST: GlobeSurfaces = { grounds: true, roads: true, nameplates: true, territories: "health", knowledgeCore: true, sessionTints: true };

/** The glass sheet's Library face: the islands as outlines with their names over the knowledge, their territories as borders
 * with no fill and no roads; a session's tints still light them (ADR-1061 D2). */
const OUTLINES = { roads: false } as const;

/** What the sheet shows: a host's switches over the Forest view; on the glass sheet's Library face (`outlines`), only the
 * islands' outlines and names. */
export function shownSurfaces(surfaces: Partial<GlobeSurfaces> | undefined, outlines = false): GlobeSurfaces {
  const shown = { ...FOREST, ...surfaces };
  return outlines ? { ...shown, ...OUTLINES, territories: shown.territories && "plain" } : shown;
}

const healthOpacity = new WeakMap<Mesh, number>();
const healthColour = new WeakMap<Mesh, Color>();
const presentation = new WeakMap<Object3D, GlobeSurfaces["territories"]>();
/** The detail each island's land shows at the eye's zoom (3.86); absent is all of it. */
const shownDetail = new WeakMap<Object3D, Detail>();
/** How far each territory has filled in on a growing globe (3.30); absent is whole. */
const grownBy = new WeakMap<Object3D, number>();
/** A fill as presented: its colour and opacity. */
type Look = { colour: Color; opacity: number };
/** How far each new territory's fill has eased in (3.46), over the fill it was carved `from` where it had one; absent is whole. */
const drawnBy = new WeakMap<Object3D, { eased: number; from: Look | undefined }>();

export function presentTerritories(group: Group, mode: GlobeSurfaces["territories"]): void {
  presentation.set(group, mode);
  // 3.86: the territories show at every zoom, the roads and relief only near; only what shows changes, never a shape.
  const land = mode !== false, near = land && (shownDetail.get(group) ?? "near") === "near";
  for (const mark of group.children) {
    if (mark.name.startsWith("territory:")) {
      const grown = grownBy.get(mark) ?? 1;
      mark.visible = land && grown > 0;
      const mesh = mark as Mesh, material = mesh.material as MeshBasicMaterial;
      if (!healthOpacity.has(mesh)) healthOpacity.set(mesh, material.opacity);
      if (!healthColour.has(mesh)) healthColour.set(mesh, material.color.clone());
      const own = healthOpacity.get(mesh)!, { eased, from } = drawnBy.get(mark) ?? { eased: 1, from: undefined };
      if (from === undefined) material.color.copy(healthColour.get(mesh)!);
      else material.color.lerpColors(from.colour, healthColour.get(mesh)!, eased);
      material.opacity = mode === "plain" ? 0 : (from === undefined ? own * eased : from.opacity + (own - from.opacity) * eased) * grown;
    } else if (mark.name === "territory-borders" || mark.name.startsWith("territory-hatch:")) {
      mark.visible = land;
    } else if (mark.name === "island-roads" || mark.name === "island-relief") {
      mark.visible = near;
    }
  }
}

/** Shows as much of an island's `land` as `detail` asks (3.86), under the territory switches it was presented with. */
export function presentDetail(land: Group, detail: Detail): void {
  shownDetail.set(land, detail);
  presentTerritories(land, presentation.get(land) ?? "health");
}

/** Session emphasis replaces materials temporarily; restoring one also restores the current presentation. */
export function restoreTerritoryPresentation(root: Object3D): void {
  root.traverse(object => {
    const mode = presentation.get(object);
    if (mode !== undefined) presentTerritories(object as Group, mode);
  });
}

/**
 * An island's land on a growing globe (3.30): each capability's territory fills in by how far the globe's growth has
 * brought it; at 1 each is exactly as drawn without one.
 * The territory switches still hold. Returns whether everything is whole.
 */
export function growLand(land: Group, grown: { capability(capability: string): number }): boolean {
  let whole = true;
  for (const mark of land.children) {
    const capability = mark.userData.capability;
    if (!mark.name.startsWith("territory:") || typeof capability !== "string") continue;
    const progress = grown.capability(capability);
    grownBy.set(mark, progress);
    whole &&= progress >= 1;
  }
  presentTerritories(land, presentation.get(land) ?? "health");
  return whole;
}

/** A new border traces on along its length over `borders` rendered seconds, at constant speed as the roads do (world 6.17).
 * A new territory's fill eases in with it, or, where it was carved from land already filled, eases in over that fill over
 * `fill` once its borders are drawn (3.46). */
export const TERRITORY_DRAW = { borders: 1, fill: 0.4 } as const;

/**
 * 3.87: an island there as the map opens stands, its land drawn whole, until a frame has drawn it whole: laid out by its
 * docks and with its roads. A whole build overtaken before any frame drew it was never on screen, so it ends nothing.
 */
export class IslandOpening {
  private open = true;
  private whole = false;

  /** A build presented, `whole` when it is the island's whole land; whether it stands. */
  built(whole: boolean): boolean {
    this.whole = whole;
    return this.open;
  }

  /** A frame drew the land as last built. */
  drew(): void {
    if (this.whole) this.open = false;
  }
}

type Segment = { key: string; from: string; to: string; index: number };
type Chain = { start: number; steps: { index: number; flip: boolean; length: number }[]; length: number };

/**
 * One island's territories arriving (3.46): what it has drawn is kept by its ground, so a rebuilt land shows the borders and
 * fills it already had, whole, from its first frame, and only new land draws on: each new border along its chain, and each new
 * territory's fill easing in with it. A territory carved from land the island already filled shows that fill until its own has
 * eased in over it, so it never shows the bare ground, which reads as parked. Hiding the territories forgets them, so showing
 * them again draws them on. Under reduced motion, or as the globe first opens, everything stands whole at once.
 */
export class TerritoryDrawOn {
  private borders = new Map<string, number>();
  private fills = new Map<string, { began: number; from: Look | undefined }>();
  /** The land last shown with its fills, which a rebuild's new territories were carved from. */
  private filled: Group | undefined;
  private land: { group: Group; lines: LineSegments; full: Float32Array; kept: number[]; chains: Chain[] } | undefined;

  /** Presents a freshly built (or re-shown) `group` at `now`, before it is drawn. */
  take(group: Group, mode: GlobeSurfaces["territories"], now: number, { standing, reduced }: { standing: boolean; reduced: boolean }): void {
    this.restore();
    presentTerritories(group, mode);
    const before = this.filled === group ? undefined : this.filled;
    this.filled = mode === "health" ? group : undefined;
    if (mode === false) { this.borders.clear(); this.fills.clear(); return; }
    const start = standing || reduced ? -Infinity : now;
    const lines = group.getObjectByName("territory-borders") as LineSegments | undefined;
    const ground: readonly number[] = lines?.userData.ground ?? [];
    const end = (x: number, z: number) => `${x.toFixed(5)},${z.toFixed(5)}`;
    const segments: Segment[] = [];
    for (let i = 0; i + 3 < ground.length; i += 4) {
      const [from, to] = [end(ground[i]!, ground[i + 1]!), end(ground[i + 2]!, ground[i + 3]!)];
      segments.push({ key: from < to ? `${from}|${to}` : `${to}|${from}`, from, to, index: i / 4 });
    }
    this.borders = new Map(segments.map(({ key }) => [key, this.borders.get(key) ?? start]));
    const lookOf = (mark: Mesh | undefined): Look | undefined => {
      const material = mark?.material as MeshBasicMaterial | undefined;
      return material === undefined ? undefined : { colour: material.color.clone(), opacity: material.opacity };
    };
    const marks = group.children.filter(mark => mark.name.startsWith("territory:"));
    this.fills = new Map(marks.map(mark => [mark.name, this.fills.get(mark.name)
      ?? { began: start, from: start === -Infinity || before === undefined ? undefined : lookOf(filledUnder(before, mark)) }]));
    if (lines !== undefined) {
      const position = lines.geometry.getAttribute("position") as BufferAttribute;
      const full = Float32Array.from(position.array as ArrayLike<number>);
      const fresh = new Map<number, Segment[]>();
      const kept: number[] = [];
      for (const segment of segments) {
        const began = this.borders.get(segment.key)!;
        if (now - began >= TERRITORY_DRAW.borders) kept.push(segment.index);
        else fresh.set(began, [...fresh.get(began) ?? [], segment]);
      }
      const chains = [...fresh].flatMap(([began, list]) => chainsOf(list, full).map(chain => ({ ...chain, start: began })));
      this.land = { group, lines, full, kept, chains };
    }
    this.frame(now, reduced);
  }

  /** Draws the land at `now`; whether anything is still arriving. */
  frame(now: number, reduced: boolean): boolean {
    const land = this.land;
    if (land === undefined) return false;
    // A plain view shows no fill, so a fill still easing in asks for no frames.
    const mode = presentation.get(land.group) ?? "health";
    let drawing = false;
    for (const mark of land.group.children) {
      const fill = this.fills.get(mark.name);
      if (fill === undefined) continue;
      const { began, from } = fill;
      const eased = reduced ? 1 : Math.min(1, Math.max(0, from === undefined ? (now - began) / TERRITORY_DRAW.borders
        : (now - began - TERRITORY_DRAW.borders) / TERRITORY_DRAW.fill));
      if (eased < 1 && mode === "health") drawing = true;
      if (eased >= 1) drawnBy.delete(mark); else drawnBy.set(mark, { eased: eased * eased * (3 - 2 * eased), from });
    }
    presentTerritories(land.group, mode);
    if (reduced || land.chains.every(chain => now - chain.start >= TERRITORY_DRAW.borders)) {
      if (land.chains.length > 0) { land.kept.push(...land.chains.flatMap(chain => chain.steps.map(step => step.index))); land.chains = []; this.restore(); }
      return drawing;
    }
    const position = land.lines.geometry.getAttribute("position") as BufferAttribute;
    const out = position.array as Float32Array;
    let count = 0;
    const put = (x: number, y: number, z: number) => { out[count * 3] = x; out[count * 3 + 1] = y; out[count * 3 + 2] = z; count++; };
    const from = (index: number, flip: boolean) => (flip ? index * 2 + 1 : index * 2) * 3;
    for (const index of land.kept) { const a = index * 6; put(land.full[a]!, land.full[a + 1]!, land.full[a + 2]!); put(land.full[a + 3]!, land.full[a + 4]!, land.full[a + 5]!); }
    for (const chain of land.chains) {
      let left = Math.min(1, Math.max(0, (now - chain.start) / TERRITORY_DRAW.borders)) * chain.length;
      for (const step of chain.steps) {
        if (left <= 0) break;
        const [a, b] = [from(step.index, step.flip), from(step.index, !step.flip)];
        const t = step.length > 0 ? Math.min(1, left / step.length) : 1;
        put(land.full[a]!, land.full[a + 1]!, land.full[a + 2]!);
        put(...[0, 1, 2].map(k => land.full[a + k]! + (land.full[b + k]! - land.full[a + k]!) * t) as [number, number, number]);
        left -= step.length;
      }
    }
    land.lines.geometry.setDrawRange(0, count);
    position.needsUpdate = true;
    return true;
  }

  /** Puts the borders back as built, every segment whole. */
  private restore(): void {
    const land = this.land;
    if (land === undefined) return;
    const position = land.lines.geometry.getAttribute("position") as BufferAttribute;
    (position.array as Float32Array).set(land.full);
    position.needsUpdate = true;
    land.lines.geometry.setDrawRange(0, Infinity);
  }
}

/** New border segments as chains to trace: each walks on from a loose end where it has one, so a line draws from end to end. */
function chainsOf(segments: readonly Segment[], full: Float32Array): Omit<Chain, "start">[] {
  const at = new Map<string, Segment[]>();
  for (const segment of segments) for (const end of [segment.from, segment.to]) at.set(end, [...at.get(end) ?? [], segment]);
  const length = (index: number) => Math.hypot(full[index * 6 + 3]! - full[index * 6]!, full[index * 6 + 4]! - full[index * 6 + 1]!, full[index * 6 + 5]! - full[index * 6 + 2]!);
  const done = new Set<Segment>();
  const chains: Omit<Chain, "start">[] = [];
  const loose = [...segments].sort((a, b) => Number(at.get(b.from)!.length === 1 || at.get(b.to)!.length === 1) - Number(at.get(a.from)!.length === 1 || at.get(a.to)!.length === 1));
  for (const first of loose) {
    if (done.has(first)) continue;
    let end = at.get(first.from)!.length === 1 || at.get(first.to)!.length !== 1 ? first.from : first.to;
    const steps: Chain["steps"] = [];
    for (let segment: Segment | undefined = first; segment !== undefined; segment = at.get(end)!.find(next => !done.has(next))) {
      done.add(segment);
      const flip = segment.to === end;
      steps.push({ index: segment.index, flip, length: length(segment.index) });
      end = flip ? segment.from : segment.to;
    }
    chains.push({ steps, length: steps.reduce((sum, step) => sum + step.length, 0) });
  }
  return chains;
}
