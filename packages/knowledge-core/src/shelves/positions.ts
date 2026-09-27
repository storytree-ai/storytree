/** Capability 1's drawing coordinates, shared by the globe and the unmounted inspection view. */
import type { RecordEnvelope } from "@storytree/library";
import type { Core } from "./shelves.js";
import { isStoryText } from "./story-text.js";

export interface Point { x: number; y: number; z: number }
interface PlacementInput { core: Core; spots: ReadonlyMap<string, Point>; radius: number }
export interface GlobePoint {
  id: string;
  at: Point;
  depth: number | undefined;
  home: string | undefined;
}

const CAPABILITY_CONE = 0.14;
const NOTE_SPREAD = 0.045;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Loose dots fill this ball; both distances are fractions of the globe radius (ADR-0661 D3). */
export const LOOSE_BALL_RADIUS = 0.55;
export const LOOSE_MIN_SEPARATION = 0.035;

/** Shelf depths inside each island, with loose knowledge spread separately through a filled ball. */
export function globePoints(core: Core, spots: ReadonlyMap<string, Point>, radius: number, notes?: ReadonlyMap<string, RecordEnvelope>): GlobePoint[] {
  const at = shelfPositions({ core, spots, radius });
  const drawn = (id: string) => {
    const record = notes?.get(id);
    return record === undefined || !isStoryText(record);
  };
  for (const id of at.keys()) if (!drawn(id)) at.delete(id);
  const outside = core.outside.filter(drawn).sort(compare);
  const loose = loosePositions(outside.length, [...at.values()].map(point => scale(point, 1 / radius)));
  outside.forEach((id, index) => at.set(id, scale(loose[index]!, radius)));
  return [...at].map(([id, point]) => ({ id, at: point, depth: core.placed.get(id)?.depth, home: core.placed.get(id)?.home }));
}

/**
 * A shuffled cubic lattice gives every dot room without clustering the first IDs in one corner.
 * Use a generous grid for the current count, then refine if shelf clearance leaves too few cells.
 * Grid spacing never falls below 0.035R, nearly three drawn dot diameters (0.012R).
 */
function loosePositions(count: number, shelf: readonly Point[]): Point[] {
  if (count === 0) return [];
  let spacing = Math.max(LOOSE_MIN_SEPARATION, 0.7 / Math.cbrt(count));
  for (;;) {
    const extent = Math.floor(LOOSE_BALL_RADIUS / spacing);
    const candidates: { at: Point; order: number }[] = [];
    for (let x = -extent; x <= extent; x++) {
      for (let y = -extent; y <= extent; y++) {
        for (let z = -extent; z <= extent; z++) {
          const at = { x: x * spacing, y: y * spacing, z: z * spacing };
          if (length(at) > LOOSE_BALL_RADIUS) continue;
          if (shelf.some(point => Math.hypot(at.x - point.x, at.y - point.y, at.z - point.z) < LOOSE_MIN_SEPARATION)) continue;
          candidates.push({ at, order: latticeOrder(x, y, z) });
        }
      }
    }
    if (candidates.length >= count) return candidates.sort((a, b) => a.order - b.order).slice(0, count).map(({ at }) => at);
    if (spacing === LOOSE_MIN_SEPARATION) throw new RangeError(`Cannot fit ${count} loose artifacts inside 0.55 radii with 0.035 radii clearance (${candidates.length} available positions).`);
    spacing = Math.max(LOOSE_MIN_SEPARATION, spacing * 0.8);
  }
}

/** Stable integer mixing; this controls order only, never distances. */
function latticeOrder(x: number, y: number, z: number): number {
  let mixed = Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function shelfPositions(input: PlacementInput): Map<string, Point> {
  const { core, radius } = input;
  const directions = shelfDirections(input);
  const at = new Map<string, Point>();
  const deepest = Math.max(0, ...[...core.placed.values()].map(({ depth }) => depth));
  const step = 0.8 / Math.max(deepest + 1, 5);
  const siblings = new Map<string, number>();
  for (const placement of [...core.placed.values()].sort((a, b) => compare(a.note, b.note))) {
    const home = directions.get(placement.home);
    if (home === undefined) continue;
    const key = `${placement.home} ${placement.depth}`;
    const index = siblings.get(key) ?? 0;
    siblings.set(key, index + 1);
    at.set(placement.note, scale(tilt(home, NOTE_SPREAD * Math.sqrt(index), index * GOLDEN), radius * (1 - step * placement.depth)));
  }
  return at;
}

/** Each shelf's direction from the centre: its story's spot, or a capability's place in a ring around it. */
export function shelfDirections({ core, spots }: PlacementInput): Map<string, Point> {
  const directions = new Map<string, Point>();
  const capabilities = new Map<string, string[]>();
  for (const { node, story } of core.shelves) if (node !== story) capabilities.set(story, [...(capabilities.get(story) ?? []), node]);
  for (const { node, story } of core.shelves) {
    const spot = spots.get(story);
    if (spot === undefined) continue;
    const ring = capabilities.get(story) ?? [];
    directions.set(node, node === story ? unit(spot) : tilt(unit(spot), CAPABILITY_CONE, (2 * Math.PI * ring.indexOf(node)) / ring.length));
  }
  return directions;
}

/** `direction` turned `angle` away from itself, toward `azimuth` around it. */
export function tilt(direction: Point, angle: number, azimuth: number): Point {
  if (angle === 0) return direction;
  const up = Math.abs(direction.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = unit(cross(up, direction));
  const v = cross(direction, u);
  const across = Math.sin(angle);
  return unit({
    x: direction.x * Math.cos(angle) + (u.x * Math.cos(azimuth) + v.x * Math.sin(azimuth)) * across,
    y: direction.y * Math.cos(angle) + (u.y * Math.cos(azimuth) + v.y * Math.sin(azimuth)) * across,
    z: direction.z * Math.cos(angle) + (u.z * Math.cos(azimuth) + v.z * Math.sin(azimuth)) * across,
  });
}

/** Point `index` of `count` spread evenly over the unit sphere. */
export function onSphere(index: number, count: number): Point {
  const y = 1 - (2 * (index + 0.5)) / count;
  const across = Math.sqrt(1 - y * y);
  return { x: Math.cos(index * GOLDEN) * across, y, z: Math.sin(index * GOLDEN) * across };
}

const cross = (a: Point, b: Point): Point => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const length = (p: Point) => Math.hypot(p.x, p.y, p.z);
export const scale = (p: Point, by: number): Point => ({ x: p.x * by, y: p.y * by, z: p.z * by });
export const unit = (p: Point): Point => scale(p, 1 / length(p));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
