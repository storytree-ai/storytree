import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";

export type Explainer = "stories" | "capabilities" | "knowledge" | "sessions" | "arcs";
/** "scale" is the return to storytree's own globe for what Conduit cannot show (ADR-0879 D7). */
export type Group = "opening" | Explainer | "scale" | "ending";
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
  why?: string; decisions: Decision[]; chips?: Chip[];
  surfaces: Partial<GlobeSurfaces>;
  /** From the given line (1-based) on, these surfaces replace the step's own. */
  lineSurfaces?: Record<number, Partial<GlobeSurfaces>>;
  /** The globe a step shows: storytree's saved reading (the default), Conduit's at one of its saved growth stages
   * (ADR-0879 D7), storytree's own recorded growth (ADR-0889 2.2b) or the shop's (ADR-0890). */
  map?: "conduit" | "own" | "shop"; stage?: string;
  /** A recorded growth: held at its point ("seed"), or replayed over `seconds` as the step plays; absent, it is whole. */
  growth?: "seed" | { seconds: number };
  /** The stories a growth's globe is narrowed to: the rest are dimmed (ADR-0890's three teaching stories). */
  focus?: readonly string[];
  /** From the given line (1-based) on, Conduit's globe shows this later stage: it grows as the step is read. */
  lineStages?: Record<number, string>;
  target?: GlobeTarget; framing?: number; drift?: boolean;
  /** A story selected so its dependency lanes draw on. */
  select?: string;
  panel?: "story" | "arcs" | "sessions" | "knowledge";
  tags?: Tag[];
};
/** Free play's project: the example shop, whole (the default), or storytree's own saved project (ADR-0890). */
export type FreePlayProject = "shop" | "storytree";
export type TourState = {
  index: number; generation: number; lines: number; speed: .75 | 1 | 1.5;
  holds: readonly Hold[]; freePlay: boolean; project: FreePlayProject;
};
export type TourDetail = { step: TourStep; state: TourState; running: boolean; elapsed: number };

/** Reading time at 1×, with a short floor even for a two-word line. */
export const readingTime = (text: string): number => Math.max(2800, text.trim().split(/\s+/).length / 2.6 * 1000);
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

/** A step's camera view: what it faces, and how close (the short half-side in globe radii). */
export type CameraView = { target?: GlobeTarget; framing: number };
/** The legs of the camera's flight from one step's view to the next on the same globe, in milliseconds at 1× (ADR-0879 D5). */
export function flight(from: CameraView, to: CameraView): { framing: number; ms: number }[] {
  // One eased flight turns the globe and zooms together: between close views it stays in and turns; to a wider view it pulls
  // back as it turns (2.15, narrowing D5's pull-back before far moves; the owner, 2026-10-04: "just stay zoomed in and rotate the globe").
  return [{ framing: to.framing, ms: JSON.stringify(from.target) === JSON.stringify(to.target) ? 1800 : 2000 }];
}

export type GlobeOn = { map: "storytree" } | { map: "conduit"; stage: string } | { map: "own" | "shop"; at?: number; focus?: readonly string[] };
/**
 * The globe on show for `step` in `state`, `elapsed` milliseconds into it: Conduit's at the stage its arrived lines have
 * reached (ADR-0879 D7), a recorded growth's (storytree's own or the shop's) at its moment in seconds or whole, narrowed
 * to the step's focus (ADR-0889 2.2b), else storytree's saved reading. Free play shows the project its selector chose (ADR-0890).
 */
export function globeOf(step: TourStep, state: TourState, elapsed = 0): GlobeOn {
  if (state.freePlay) return state.project === "shop" ? { map: "shop" } : { map: "storytree" };
  if (!step.map || state.holds.includes("everything")) return { map: "storytree" };
  if (step.map === "own" || step.map === "shop") {
    const focus = step.focus ? { focus: step.focus } : {};
    if (step.growth === "seed") return { map: step.map, at: 0, ...focus };
    return step.growth ? { map: step.map, at: Math.min(step.growth.seconds, elapsed / 1000), ...focus } : { map: step.map, ...focus };
  }
  let stage = step.stage ?? "complete";
  for (const [from, next] of Object.entries(step.lineStages ?? {})) if (state.lines >= Number(from)) stage = next;
  return { map: "conduit", stage };
}
