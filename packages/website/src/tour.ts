/** Capability 2 · The forest on the site. */
import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";

/** "map" and "agents" are Act 2's first two chapters, taught on the shop (ADR-0891, ADR-0893). */
export type Explainer = "map" | "agents" | "knowledge";
export type Group = "opening" | Explainer | "ending";
/** Why the tour is waiting: the visitor's pause, a step's depth being read, every surface shown, or the globe being explored. */
export type Hold = "paused" | "reading" | "everything" | "exploring";
export type Decision = { number: number; title: string };
export type Source = { name: string; url: string };
export type Chip = { kind: "principle" | "partial" | "recording"; text: string };
/** A ring on the thing a step talks about, with its name beside it. */
export type Tag = { target: GlobeTarget; text: string };
export type TourStep = {
  id: string; explainer: Group; title: string;
  /** beats replace one another; lines accumulate; a comparison's lines each carry a source; a statement is a headline and
   * its subhead, alone; fixes pair each pain (its note) with its fix (its line). */
  kind?: "beats" | "lines" | "compare" | "statement" | "fixes";
  lines: string[];
  notes?: string[]; sources?: (Source | undefined)[];
  /** A step's depth: how it works and why it exists, as curated explainers (ADR-0891); a comparison offered there. */
  how?: string; why?: string; decisions: Decision[]; chips?: Chip[];
  compare?: { lines: string[]; sources: (Source | undefined)[] };
  surfaces: Partial<GlobeSurfaces>;
  /** From the given line (1-based) on, these surfaces replace the step's own. */
  lineSurfaces?: Record<number, Partial<GlobeSurfaces>>;
  /** The globe a step shows: storytree's saved reading (the default), storytree's own recorded growth (ADR-0889 2.2b)
   * or the shop's (ADR-0890). */
  map?: "own" | "shop";
  /** A recorded growth: held at its point ("seed"), or replayed over `seconds` as the step plays, whole or only its
   * named `stage` (from the globe as it stood before that stage, to where the next begins, or to where the stage named `until`
   * begins); absent, it is whole. */
  growth?: "seed" | { seconds: number; stage?: string; until?: string };
  /** A moment in the shop's records: its globe, its sessions and its arcs as they stood then (ADR-0893). */
  recorded?: string;
  /** The stories a growth's globe is narrowed to: the rest are dimmed (ADR-0890's teaching stories). */
  focus?: readonly string[];
  target?: GlobeTarget; framing?: number; drift?: boolean;
  /** A laptop's own view where a phone's would not fit its panels (wider than 600px). */
  laptop?: { target: GlobeTarget; framing: number };
  /** A phone's own view (600px wide or less), with the globe's middle `side` pixels right of the screen's. */
  phone?: { target?: GlobeTarget; framing: number; side: number };
  /** A story selected so its dependency lanes draw on. */
  select?: string;
  panel?: "story" | "arcs" | "sessions" | "knowledge";
  /** Open the panel when this line is told, after the map has shown its preceding ideas. */
  panelFromLine?: number;
  tags?: Tag[];
};
/** Free play's project: the example shop, whole (the default), or storytree's own saved project (ADR-0890). */
export type FreePlayProject = "shop" | "storytree";
export type TourState = {
  index: number; generation: number; lines: number; speed: .75 | 1 | 1.5;
  holds: readonly Hold[]; freePlay: boolean; project: FreePlayProject;
};
export type TourDetail = { step: TourStep; state: TourState; running: boolean; elapsed: number };

/** How long words take to say at 1×: 2.6 words a second. */
const spoken = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length / 2.6 * 1000;
/** Reading time at 1×, with a short floor even for a two-word line. */
export const readingTime = (text: string): number => Math.max(2800, spoken(text));
/** A step rests on its last line before the camera moves on. */
export const settle = 1200;
/** A step that replays a growth lasts as long as it does, however short its words. */
const duration = (step: TourStep) => Math.max(step.lines.reduce((sum, line) => sum + readingTime(line), 0), typeof step.growth === "object" ? step.growth.seconds * 1000 : 0) + settle;
const shown = (step: TourStep, elapsed: number) => {
  let start = 0, count = 0;
  for (const line of step.lines) { if (elapsed >= start) count++; start += readingTime(line); }
  return Math.max(1, Math.min(count, step.lines.length));
};

/** The progress bar's groups: consecutive steps of one explainer share a group. */
export function groups(steps: readonly TourStep[]): { explainer: Group; steps: number[] }[] {
  const out: { explainer: Group; steps: number[] }[] = [];
  steps.forEach((step, index) => {
    const last = out.at(-1);
    if (last?.explainer === step.explainer) last.steps.push(index);
    else out.push({ explainer: step.explainer, steps: [index] });
  });
  return out;
}

/** `ready` says whether the globe a growth plays on is set up: until it is, the time-lapse and the step before it wait (2.10). */
export function createTour(steps: readonly TourStep[], { ready = () => true }: { ready?: () => boolean } = {}) {
  if (!steps.length) throw new Error("A tour needs at least one step.");
  let state: TourState = { index: 0, generation: 0, lines: 1, speed: .75, holds: [], freePlay: false, project: "shop" };
  let elapsed = 0;
  const update = (patch: Partial<TourState>) => state = { ...state, ...patch };
  const all = (index = state.index) => steps[index]!.lines.length;
  /** Moving to a step keeps only the visitor's own pause: a paused tour steps through by hand, each step shown whole. */
  const enter = (index: number) => {
    elapsed = 0;
    const holds = state.holds.includes("paused") ? ["paused" as const] : [];
    return update({ index, holds, lines: holds.length ? all(index) : 1, freePlay: false });
  };
  const tour = {
    get state() { return state; },
    get running() { return !state.freePlay && state.holds.length === 0; },
    /** How far the current step has played, 0 to 1; it holds still while the tour waits. */
    progress() { return state.freePlay ? 1 : Math.min(1, elapsed / duration(steps[state.index]!)); },
    /** How long the current step has played, in milliseconds at its speed; it holds still while the tour waits. */
    elapsed() { return elapsed; },
    tick(milliseconds: number) {
      if (!tour.running || !Number.isFinite(milliseconds) || milliseconds <= 0) return state;
      const step = steps[state.index]!;
      const grows = (index: number) => typeof steps[index]?.growth === "object";
      if (grows(state.index) && !ready()) return state;
      elapsed += milliseconds * state.speed;
      if (elapsed >= duration(step) - 1e-6) {
        if (!grows(state.index + 1) || ready()) return tour.next();
        elapsed = duration(step) - 1e-6;
      }
      const lines = Math.max(state.lines, shown(step, elapsed));
      return lines === state.lines ? state : update({ lines });
    },
    go(index: number) { return index < 0 || index >= steps.length ? state : enter(index); },
    next() {
      if (state.freePlay) return state;
      return state.index + 1 >= steps.length ? update({ freePlay: true, holds: [] }) : enter(state.index + 1);
    },
    previous() { return state.freePlay ? enter(steps.length - 1) : enter(Math.max(0, state.index - 1)); },
    replay() { elapsed = 0; return update({ index: 0, generation: state.generation + 1, lines: 1, holds: [], freePlay: false }); },
    skip() { return update({ freePlay: true, holds: [] }); },
    hold(reason: Hold) {
      if (state.freePlay || state.holds.includes(reason)) return state;
      return update({ holds: [...state.holds, reason], lines: all() });
    },
    release(reason: Hold) { return state.holds.includes(reason) ? update({ holds: state.holds.filter(hold => hold !== reason) }) : state; },
    /** Play clears every hold and continues the step where it stopped; pause is the visitor's own hold. */
    togglePlay() { return state.freePlay ? state : tour.running ? tour.hold("paused") : update({ holds: [] }); },
    setSpeed(speed: .75 | 1 | 1.5) { return update({ speed }); },
    /** The selector's choice of free play's project; it lasts as long as the page. */
    choose(project: FreePlayProject) { return state.project === project ? state : update({ project }); },
  };
  return tour;
}

/**
 * Where in a recorded growth's plan (its seconds) a step that replays it stands, `told` seconds into the step's replay:
 * across the whole growth, or across only its named stage, from where that stage begins to where the next does, or the stage
 * named `until` (2.12, 2.16).
 */
export function replayMoment(plan: { seconds: number; stages: readonly { id: string; start: number }[] }, growth: { seconds: number; stage?: string; until?: string }, told: number): number {
  const at = growth.stage === undefined ? -1 : plan.stages.findIndex(stage => stage.id === growth.stage);
  const until = growth.until === undefined ? undefined : plan.stages.find(stage => stage.id === growth.until)?.start;
  const from = at < 0 ? 0 : plan.stages[at]!.start, to = until ?? (at < 0 ? plan.seconds : plan.stages[at + 1]?.start ?? plan.seconds);
  return from + Math.min(1, Math.max(0, told / growth.seconds)) * (to - from);
}

/** A step's camera view: what it faces, and how close (the short half-side in globe radii). */
export type CameraView = { target?: GlobeTarget; framing: number };
/** The legs of the camera's flight from one step's view to the next on the same globe, in milliseconds at 1× (ADR-0879 D5). */
export function flight(from: CameraView, to: CameraView): { framing: number; ms: number }[] {
  // One eased flight turns the globe and zooms together: between close views it stays in and turns; to a wider view it pulls
  // back as it turns (2.15, narrowing D5's pull-back before far moves; the owner, 2026-10-04: "just stay zoomed in and rotate the globe").
  return [{ framing: to.framing, ms: JSON.stringify(from.target) === JSON.stringify(to.target) ? 1800 : 2000 }];
}

/**
 * Aims the camera at `target`, or at `overview` when a part or file is not on the globe. A globe swapped in can be drawn
 * after its step begins: an island not found yet is aimed at again on a later beat (`again`), so the camera never keeps the
 * last step's turn; after `tries` it gives up.
 */
export function aim(place: (target: GlobeTarget) => boolean, target: GlobeTarget, overview: GlobeTarget, again: (run: () => void) => void, tries = 100): void {
  if (place(target) || (target.kind !== "story" && place(overview))) return;
  if (tries > 0) again(() => aim(place, target, overview, again, tries - 1));
}

export type GlobeOn = { map: "storytree" } | { map: "own" | "shop"; at?: number; when?: string; focus?: readonly string[] };
/**
 * The globe on show for `step` in `state`, `elapsed` milliseconds into it: a recorded growth's (storytree's own or the
 * shop's) at its moment in seconds or whole, narrowed to the step's focus (ADR-0889 2.2b), else storytree's saved reading.
 * Free play shows the project its selector chose (ADR-0890).
 */
export function globeOf(step: TourStep, state: TourState, elapsed = 0): GlobeOn {
  if (state.freePlay) return state.project === "shop" ? { map: "shop" } : { map: "storytree" };
  if (!step.map || state.holds.includes("everything")) return { map: "storytree" };
  const focus = step.focus ? { focus: step.focus } : {};
  if (step.growth === "seed") return { map: step.map, at: 0, ...focus };
  if (step.recorded) return { map: step.map, when: step.recorded, ...focus };
  return step.growth ? { map: step.map, at: Math.min(step.growth.seconds, elapsed / 1000), ...focus } : { map: step.map, ...focus };
}

export type Box = { x: number; y: number; width: number; height: number };
export type TagSide = "right" | "left" | "below" | "above";
const ring = 17, gap = 24, margin = 8;
const meet = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/**
 * Where each tag's name sits, as its box's top-left from its ring's middle: `tags` are the rings' middles with their names'
 * sizes. A name takes the first of `sides` (its `previous` side first, so it does not flit) where it stays inside the room,
 * clear of the names already placed, the other rings and `keepOut`; where none is clear, the side that covers least, a
 * `soft` box (an island's name) counting a fifth as much as a ring, a name or a panel. With `share` (a laptop), a side is
 * clear allowing for rounding, and when taking sides first come, first served leaves a name over a ring, a name, a panel or
 * the room's edge, up to four names share the room instead: every choice of sides, a name above or below also flush with
 * its ring's left or right edge, is weighed and the one that covers least wins, the hard boxes first. A phone keeps the
 * first-come placement it was given, a name beside its ring also trying a little higher or lower once the four sides are
 * not clear (2.18).
 */
export function placeTags(tags: readonly Box[], room: { width: number; height: number }, { keepOut = [], sides = ["right", "left"], previous = [], share = false }: { keepOut?: readonly (Box & { soft?: boolean })[]; sides?: readonly TagSide[]; previous?: readonly (TagSide | undefined)[]; share?: boolean } = {}): { side: TagSide; x: number; y: number }[] {
  const rings = tags.map(tag => ({ x: tag.x - ring, y: tag.y - ring, width: ring * 2, height: ring * 2 }));
  // Each name's sides in the order it tries them, each with what it covers apart from the other names: `hard` counts the
  // rings, the panels and four times what falls outside the room; `cost` adds a fifth of the islands' names it covers.
  const options = tags.map((tag, index) => {
    const across = Math.min(Math.max(margin, tag.x - tag.width / 2), room.width - margin - tag.width) - tag.x;
    const offsets: Record<TagSide, { x: number; y: number }> = {
      right: { x: gap, y: -tag.height / 2 }, left: { x: -gap - tag.width, y: -tag.height / 2 },
      below: { x: across, y: gap }, above: { x: across, y: -gap - tag.height },
    };
    const order = [...new Set([previous[index], ...sides].filter((side): side is TagSide => !!side && sides.includes(side)))];
    // After the four sides, a name above or below may also sit flush with its ring's left or right edge rather than centred.
    const flush = !share ? [] : order.filter(side => side === "below" || side === "above").flatMap(side => [ring - tag.width, -ring].map(x => ({ side, x, y: offsets[side].y })));
    // On a phone, a name beside its ring may also slide up or down by up to half the ring, to clear an island's name.
    const slid = share ? [] : order.filter(side => side === "right" || side === "left").flatMap(side => [-ring / 4, ring / 4, -ring / 2, ring / 2].map(y => ({ side, x: offsets[side].x, y: offsets[side].y + y })));
    // A taller progress label can close the vertical gap. Move beside its edge, still within the screen, before covering it.
    const beside = share ? [] : order.filter(side => side === "right" || side === "left").flatMap(side => keepOut.map(other => ({ side,
      x: side === "right" ? Math.min(room.width - margin - tag.width - tag.x, Math.max(gap, other.x + other.width + margin - tag.x))
        : Math.max(margin - tag.x, Math.min(-gap - tag.width, other.x - margin - tag.width - tag.x)), y: offsets[side].y })))
      .filter(option => option.side === "right" ? option.x >= gap : option.x <= -gap - tag.width);
    return [...order.map(side => ({ side, ...offsets[side] })), ...flush, ...slid, ...beside].map(({ side, ...at }) => {
      const box = { x: tag.x + at.x, y: tag.y + at.y, width: tag.width, height: tag.height };
      const inside = tag.width * tag.height - meet(box, { x: margin, y: margin, width: room.width - margin * 2, height: room.height - margin * 2 });
      const outside = share ? Math.max(0, inside) : inside;
      const others = [...rings.filter((_, other) => other !== index), ...keepOut];
      const hard = outside * 4 + others.reduce((sum, other) => sum + ("soft" in other && other.soft ? 0 : meet(box, other)), 0);
      return { side, ...at, box, hard, cost: hard + others.reduce((sum, other) => sum + ("soft" in other && other.soft ? meet(box, other) * .2 : 0), 0) };
    });
  });
  // Sharing allows for rounding: fractional boxes can leave a side a hair above or below zero.
  const clear = (value: number) => share ? Math.abs(value) < 1e-6 : value === 0;
  const placed: Box[] = [];
  const first = options.map(sided => {
    const scored = sided.map(option => { const names = placed.reduce((sum, other) => sum + meet(option.box, other), 0); return { option, hard: option.hard + names, cost: option.cost + names }; });
    const best = scored.find(choice => clear(choice.cost)) ?? scored.reduce((a, b) => b.cost < a.cost ? b : a);
    placed.push(best.option.box);
    return best;
  });
  const weigh = (choice: readonly (typeof options)[number][number][]) => {
    const names = choice.reduce((sum, option, index) => sum + choice.slice(index + 1).reduce((more, other) => more + meet(option.box, other.box), 0), 0);
    return { hard: choice.reduce((sum, option) => sum + option.hard, 0) + names, cost: choice.reduce((sum, option) => sum + option.cost, 0) + names };
  };
  let chosen = first.map(({ option }) => option);
  if (share && !clear(first.reduce((sum, { hard }) => sum + hard, 0)) && tags.length <= 4) {
    let best = weigh(chosen);
    const choose = (index: number, choice: (typeof options)[number][number][]): void => {
      if (index === options.length) {
        const weighed = weigh(choice);
        if (weighed.hard < best.hard - 1e-6 || (clear(weighed.hard - best.hard) && weighed.cost < best.cost - 1e-6)) { best = weighed; chosen = [...choice]; }
        return;
      }
      for (const option of options[index]!) choose(index + 1, [...choice, option]);
    };
    choose(0, []);
  }
  return chosen.map(option => ({ side: option.side, x: option.x, y: option.y }));
}
