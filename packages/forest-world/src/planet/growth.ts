// Capability 5 · Growth
import type { ForestScene } from '../scene.js';
import { roadDrawSeconds } from './lanes.js';
import type { PlanetPathways } from './pathways.js';

export interface GrowthWindow { start: number; seconds: number }

export interface GrowthStage { id?: string; at?: string; scene: ForestScene; hold?: number }

export interface GrowthOptions {
  seconds?: number;
  fromPoint?: boolean;
  roadLength?: (link: string) => number;
  until?: string;
}

export interface GrowthPlan {
  seconds: number;
  globe?: GrowthWindow;
  islands: Map<string, GrowthWindow>;
  roads: Map<string, GrowthWindow>;
  capabilities: Map<string, GrowthWindow>;
  stages: { id: string; start: number; at?: string }[];
  until?: string;
}

const RISE = 0.76;
const FILL_DELAY = 0.37;
const BASE_SPREAD = 1.2;
const UNREACHED_GAP = 0.26;
const PART_STAGGER = 0.12;
const STAGE_GAP = 0.3;
const GLOBE_SWELL = 1.2;
const TYPICAL_ROAD = 300;

export const linkKey = (link: { from: string; to: string }) => `${link.from}->${link.to}`;

export function growthPlan(stages: readonly GrowthStage[], options: GrowthOptions = {}): GrowthPlan {
  const plan: GrowthPlan = { seconds: 0, islands: new Map(), roads: new Map(), capabilities: new Map(), stages: [] };
  const roadSeconds = (link: string) => roadDrawSeconds(options.roadLength?.(link) ?? TYPICAL_ROAD);
  const end = (w: GrowthWindow) => w.start + w.seconds;
  let at = 0;
  let heldTo = 0;
  const roadOn = new Map<string, string>(), partOn = new Map<string, string>();
  if (options.fromPoint) { plan.globe = { start: 0, seconds: GLOBE_SWELL }; at = GLOBE_SWELL; }
  stages.forEach((stage, index) => {
    const { islands } = stage.scene;
    const storyOf = new Map(islands.flatMap(i => [[i.story, i.story] as const, ...i.trees.flatMap(t => t.capability === undefined ? [] : [[t.capability, i.story] as const])]));
    const fresh = islands.filter(i => !plan.islands.has(i.story)).map(i => i.story);
    const ends = (l: { from: string; to: string }) => `${storyOf.get(l.from)}->${storyOf.get(l.to)}`;
    const links = (stage.scene.links ?? []).filter(l => storyOf.has(l.from) && storyOf.has(l.to) && roadOn.get(linkKey(l)) !== ends(l));
    const settled = new Map<string, number>(islands.filter(i => plan.islands.has(i.story)).map(i => [i.story, at]));
    const start = new Map<string, number>();
    const reached = new Set(links.filter(l => storyOf.get(l.from) !== storyOf.get(l.to)).map(l => storyOf.get(l.from)!));
    const base = fresh.filter(s => !reached.has(s));
    base.forEach((s, i) => start.set(s, at + (base.length > 1 ? BASE_SPREAD * i / (base.length - 1) : 0)));
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
    let last = Math.max(at, ...[...start.values()].map(s => s + RISE));
    for (const story of fresh.filter(s => !done.has(s))) { start.set(story, last); settle(story, last + RISE); last += UNREACHED_GAP; }
    const windows: GrowthWindow[] = [];
    const put = <K>(map: Map<K, GrowthWindow>, key: K, w: GrowthWindow) => { map.set(key, w); windows.push(w); };
    for (const story of fresh) put(plan.islands, story, { start: start.get(story)!, seconds: RISE });
    for (const l of links) put(plan.roads, linkKey(l), { start: settled.get(storyOf.get(l.to)!)!, seconds: roadSeconds(linkKey(l)) });
    for (const island of islands) {
      const rising = fresh.includes(island.story);
      const from = rising ? plan.islands.get(island.story)!.start + FILL_DELAY : at;
      const parts = island.trees.flatMap(t => t.capability === undefined || partOn.get(t.capability) === island.story ? [] : [t.capability]);
      parts.forEach((capability, i) => { put(plan.capabilities, capability, { start: from + (rising ? 0 : PART_STAGGER * i), seconds: RISE }); partOn.set(capability, island.story); });
    }
    for (const l of links) roadOn.set(linkKey(l), ends(l));
    const hold = stage.hold ?? 0;
    if (windows.length === 0 && hold <= 0) return;
    plan.stages.push({ id: stage.id ?? String(index), start: at, ...(stage.at === undefined ? {} : { at: stage.at }) });
    heldTo = at + hold;
    at = Math.max(heldTo, ...windows.map(end)) + STAGE_GAP;
  });
  const natural = Math.max(heldTo, plan.globe ? end(plan.globe) : 0, ...[...plan.islands.values(), ...plan.roads.values(),
    ...plan.capabilities.values()].map(end));
  plan.seconds = natural;
  if (options.until !== undefined) plan.until = options.until;
  if (options.seconds !== undefined && natural > 0) scale(plan, options.seconds / natural);
  return plan;
}

function scale(plan: GrowthPlan, k: number) {
  const each = (w: GrowthWindow) => { w.start *= k; w.seconds *= k; };
  if (plan.globe) each(plan.globe);
  for (const map of [plan.islands, plan.roads, plan.capabilities]) map.forEach(each);
  for (const stage of plan.stages) stage.start *= k;
  plan.seconds *= k;
}

export function growthMoment(plan: GrowthPlan, date: string): number {
  const knots = plan.stages.flatMap(s => s.at === undefined ? [] : [{ t: Date.parse(s.at), start: s.start }]);
  if (plan.until !== undefined && knots.length > 0) knots.push({ t: Date.parse(plan.until), start: plan.seconds });
  const t = Date.parse(date);
  if (knots.length === 0) return plan.stages[0]?.start ?? 0;
  if (t <= knots[0]!.t) return knots[0]!.start;
  for (let i = 1; i < knots.length; i++) {
    const [a, b] = [knots[i - 1]!, knots[i]!];
    if (t <= b.t) return b.t > a.t ? a.start + (b.start - a.start) * (t - a.t) / (b.t - a.t) : b.start;
  }
  return knots.at(-1)!.start;
}

export function growthNow(fixed: number | undefined, elapsed: number, reducedMotion: boolean): number {
  if (fixed !== undefined) return fixed;
  return reducedMotion ? Infinity : elapsed;
}

export function growthProgress(window: GrowthWindow | undefined, t: number, reducedMotion: boolean): number {
  if (reducedMotion || window === undefined) return 1;
  if (t <= window.start) return 0;
  const x = window.seconds > 0 ? Math.min(1, (t - window.start) / window.seconds) : 1;
  return 1 - (1 - x) ** 3;
}

export function plateGrowth(progress: number): { visible: boolean; scale: number; sink: number } {
  if (progress <= 0) return { visible: false, scale: 0, sink: 1 };
  return { visible: true, scale: progress, sink: 1 - progress };
}

export function crossingLength(pathways: PlanetPathways, link: string): number {
  const edge = pathways.lanes.edges.find(e => linkKey(e) === link);
  if (edge === undefined) return 0;
  const segments = new Map(pathways.lanes.segments.map(s => [s.id, s]));
  return edge.segments.reduce((sum, ref) => {
    const s = segments.get(ref.id);
    return s === undefined ? sum : sum + s.points.slice(1).reduce((d, q, i) => d + q.distanceTo(s.points[i]!), 0);
  }, 0);
}
