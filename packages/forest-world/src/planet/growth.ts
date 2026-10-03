/** The globe's growth (world contracts 7.1–7.4): a recorded sequence of plan states replayed as islands rising
 * and roads drawing on, choreographed the way 0.2's arrival was (ADR-0639: its behaviour, not its code). */
import type { ForestScene } from '../scene.js';
import { laneDrawSeconds } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

/** When something grows, in seconds from the growth's start. */
export interface GrowthWindow { start: number; seconds: number }

/** One recorded plan state; stages run in the order given. */
export interface GrowthStage { id?: string; scene: ForestScene }

export interface GrowthOptions {
  /** The whole growth's length; the plan is scaled by one factor to it. Absent, it keeps its natural pace. */
  seconds?: number;
  /** The globe swells from a point of light before the first island rises. */
  fromPoint?: boolean;
  /** A road's drawn length in ground units, `from->to`; absent, a typical road's. */
  roadLength?: (link: string) => number;
}

export interface GrowthPlan {
  seconds: number;
  globe?: GrowthWindow;
  islands: Map<string, GrowthWindow>;
  /** Keyed `from->to`, as the capability links are recorded. */
  roads: Map<string, GrowthWindow>;
  capabilities: Map<string, GrowthWindow>;
  /** Keyed by story and path, joined by a newline. */
  files: Map<string, GrowthWindow>;
  /** The stages that added something, and when each began. */
  stages: { id: string; start: number }[];
}

// 0.2's arrival pacing, in its seconds.
const RISE = 0.76;
const FILL_DELAY = 0.37;
const BASE_SPREAD = 1.2;
const UNREACHED_GAP = 0.26;
const PART_STAGGER = 0.12;
const STAGE_GAP = 0.3;
const GLOBE_SWELL = 1.2;
const TYPICAL_ROAD = 300;

export const linkKey = (link: { from: string; to: string }) => `${link.from}->${link.to}`;
export const fileKey = (story: string, path: string) => `${story}\n${path}`;

/** Replay `stages` as growth: what appears first in each stage, and when, never anything no stage holds. */
export function growthPlan(stages: readonly GrowthStage[], options: GrowthOptions = {}): GrowthPlan {
  const plan: GrowthPlan = { seconds: 0, islands: new Map(), roads: new Map(), capabilities: new Map(), files: new Map(), stages: [] };
  const roadSeconds = (link: string) => laneDrawSeconds(options.roadLength?.(link) ?? TYPICAL_ROAD);
  const end = (w: GrowthWindow) => w.start + w.seconds;
  let at = 0;
  if (options.fromPoint) { plan.globe = { start: 0, seconds: GLOBE_SWELL }; at = GLOBE_SWELL; }
  stages.forEach((stage, index) => {
    const { islands } = stage.scene;
    const storyOf = new Map(islands.flatMap(i => i.trees.flatMap(t => t.capability === undefined ? [] : [[t.capability, i.story] as const])));
    const fresh = islands.filter(i => !plan.islands.has(i.story)).map(i => i.story);
    const links = (stage.scene.links ?? []).filter(l => storyOf.has(l.from) && storyOf.has(l.to) && !plan.roads.has(linkKey(l)));
    const settled = new Map<string, number>(islands.filter(i => plan.islands.has(i.story)).map(i => [i.story, at]));
    const start = new Map<string, number>();
    // Islands no road reaches from another island start spread over a beat; the rest wait for their roads.
    const reached = new Set(links.filter(l => storyOf.get(l.from) !== storyOf.get(l.to)).map(l => storyOf.get(l.from)!));
    const base = fresh.filter(s => !reached.has(s));
    base.forEach((s, i) => start.set(s, at + (base.length > 1 ? BASE_SPREAD * i / (base.length - 1) : 0)));
    // Earliest arrival first, as 0.2 did: a settled island sends its roads, and each dependent rises as its first arrives.
    const roadsOut = (story: string) => links.filter(l => storyOf.get(l.to) === story && storyOf.get(l.from) !== story);
    const done = new Set<string>();
    const settle = (story: string, when: number) => {
      done.add(story);
      settled.set(story, when);
      for (const l of roadsOut(story)) {
        const dependent = storyOf.get(l.from)!;
        if (!fresh.includes(dependent) || done.has(dependent)) continue;
        const arrives = when + roadSeconds(linkKey(l));
        if (arrives < (start.get(dependent) ?? Infinity)) start.set(dependent, arrives);
      }
    };
    for (const [story, when] of [...settled]) settle(story, when);
    for (;;) {
      const next = fresh.filter(s => !done.has(s) && start.has(s)).sort((a, b) => start.get(a)! - start.get(b)!)[0];
      if (next === undefined) break;
      settle(next, start.get(next)! + RISE);
    }
    // Islands only on a cycle nothing reaches still rise, after the rest.
    let last = Math.max(at, ...[...start.values()].map(s => s + RISE));
    for (const story of fresh.filter(s => !done.has(s))) { start.set(story, last); settle(story, last + RISE); last += UNREACHED_GAP; }
    const windows: GrowthWindow[] = [];
    const put = <K>(map: Map<K, GrowthWindow>, key: K, w: GrowthWindow) => { map.set(key, w); windows.push(w); };
    for (const story of fresh) put(plan.islands, story, { start: start.get(story)!, seconds: RISE });
    for (const l of links) put(plan.roads, linkKey(l), { start: settled.get(storyOf.get(l.to)!)!, seconds: roadSeconds(linkKey(l)) });
    // Parts and files fill in behind a rising island, or join a standing one at the stage's start, staggered.
    for (const island of islands) {
      const rising = fresh.includes(island.story);
      const from = rising ? plan.islands.get(island.story)!.start + FILL_DELAY : at;
      const parts = island.trees.flatMap(t => t.capability === undefined || plan.capabilities.has(t.capability) ? [] : [t.capability]);
      parts.forEach((capability, i) => put(plan.capabilities, capability, { start: from + (rising ? 0 : PART_STAGGER * i), seconds: RISE }));
      const files = (island.land?.files ?? []).map(f => fileKey(island.story, f.path)).filter(key => !plan.files.has(key));
      files.forEach(key => put(plan.files, key, { start: rising ? from : at + FILL_DELAY, seconds: RISE }));
    }
    if (windows.length === 0) return;
    plan.stages.push({ id: stage.id ?? String(index), start: at });
    at = Math.max(...windows.map(end)) + STAGE_GAP;
  });
  const natural = Math.max(plan.globe ? end(plan.globe) : 0, ...[...plan.islands.values(), ...plan.roads.values(),
    ...plan.capabilities.values(), ...plan.files.values()].map(end));
  plan.seconds = natural;
  if (options.seconds !== undefined && natural > 0) scale(plan, options.seconds / natural);
  return plan;
}

/** One factor for every window: order and relative pacing survive (0.2's ceiling, and a stretch too). */
function scale(plan: GrowthPlan, k: number) {
  const each = (w: GrowthWindow) => { w.start *= k; w.seconds *= k; };
  if (plan.globe) each(plan.globe);
  for (const map of [plan.islands, plan.roads, plan.capabilities, plan.files]) map.forEach(each);
  for (const stage of plan.stages) stage.start *= k;
  plan.seconds *= k;
}

/** How grown something is at `t`: an ease-out that never passes whole; whole at once under reduced motion, or when unscheduled. */
export function growthProgress(window: GrowthWindow | undefined, t: number, reducedMotion: boolean): number {
  if (reducedMotion || window === undefined) return 1;
  if (t <= window.start) return 0;
  const x = window.seconds > 0 ? Math.min(1, (t - window.start) / window.seconds) : 1;
  return 1 - (1 - x) ** 3;
}

/** A plate at `progress`: hidden until it starts, then swelling from its middle as it rises out of the glass. */
export function plateGrowth(progress: number): { visible: boolean; scale: number; sink: number } {
  if (progress <= 0) return { visible: false, scale: 0, sink: 1 };
  return { visible: true, scale: progress, sink: 1 - progress };
}

/** How each cross-island road segment draws on: its road's window split by length, at constant speed from the
 * capability built on; a segment several roads share is drawn by the earliest. */
export function roadSegmentWindows(pathways: PlanetPathways, roads: ReadonlyMap<string, GrowthWindow>): Map<string, GrowthWindow & { fromEnd: boolean }> {
  const segments = new Map(pathways.segments.map(s => [s.id, s]));
  const length = (id: string) => { const p = segments.get(id)!.points; return p.slice(1).reduce((sum, q, i) => sum + q.distanceTo(p[i]!), 0); };
  const out = new Map<string, GrowthWindow & { fromEnd: boolean }>();
  for (const edge of pathways.edges) {
    const road = roads.get(linkKey(edge));
    if (road === undefined) continue;
    // The chain runs from the building capability to the one built on; the road draws back along it.
    const walk = [...edge.segments].reverse().filter(ref => segments.get(ref.id)?.island === undefined);
    const total = walk.reduce((sum, ref) => sum + length(ref.id), 0);
    let at = road.start;
    for (const ref of walk) {
      const seconds = total > 0 ? road.seconds * length(ref.id) / total : 0;
      const old = out.get(ref.id);
      if (old === undefined || at < old.start) out.set(ref.id, { start: at, seconds, fromEnd: !ref.reversed });
      at += seconds;
    }
  }
  return out;
}

/** A road strip's draw range at `drawn` of its `quads`, from its start or its far end. */
export function segmentDrawRange(quads: number, drawn: number, fromEnd: boolean): { start: number; count: number } {
  const shown = Math.round(Math.min(1, Math.max(0, drawn)) * quads);
  return { start: fromEnd ? (quads - shown) * 6 : 0, count: shown * 6 };
}

/** A road's drawn length across the glass, in ground units: what its draw-on time follows. */
export function crossingLength(pathways: PlanetPathways, link: string): number {
  const edge = pathways.edges.find(e => linkKey(e) === link);
  if (edge === undefined) return 0;
  const segments = new Map(pathways.segments.map(s => [s.id, s]));
  return edge.segments.reduce((sum, ref) => {
    const s = segments.get(ref.id);
    return s === undefined || s.island !== undefined ? sum : sum + s.points.slice(1).reduce((d, q, i) => d + q.distanceTo(s.points[i]!), 0);
  }, 0);
}
