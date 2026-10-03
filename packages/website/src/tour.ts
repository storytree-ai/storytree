import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";

export type Explainer = "stories" | "capabilities" | "knowledge" | "sessions" | "arcs";
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
  /** beats replace one another; principles and lines accumulate; a comparison's lines each carry a source. */
  kind?: "beats" | "principles" | "lines" | "compare";
  lines: string[];
  notes?: string[]; sources?: (Source | undefined)[];
  why?: string; decisions: Decision[]; chips?: Chip[];
  surfaces: Partial<GlobeSurfaces>;
  /** From the given line (1-based) on, these surfaces replace the step's own. */
  lineSurfaces?: Record<number, Partial<GlobeSurfaces>>;
  target?: GlobeTarget; framing?: number; drift?: boolean;
  /** A story selected so its dependency lanes draw on. */
  select?: string;
  panel?: "story" | "arcs" | "sessions" | "knowledge";
  tags?: Tag[];
};
export type TourState = {
  index: number; generation: number; lines: number; speed: .75 | 1 | 1.5;
  holds: readonly Hold[]; freePlay: boolean;
};
export type TourDetail = { step: TourStep; state: TourState; running: boolean };

/** Reading time at 1×, with a short floor even for a two-word line. */
export const readingTime = (text: string): number => Math.max(2800, text.trim().split(/\s+/).length / 2.6 * 1000);
/** A step rests on its last line before the camera moves on. */
export const settle = 1200;
const duration = (step: TourStep) => step.lines.reduce((sum, line) => sum + readingTime(line), 0) + settle;
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

export function createTour(steps: readonly TourStep[]) {
  if (!steps.length) throw new Error("A tour needs at least one step.");
  let state: TourState = { index: 0, generation: 0, lines: 1, speed: 1, holds: [], freePlay: false };
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
    tick(milliseconds: number) {
      if (!tour.running || !Number.isFinite(milliseconds) || milliseconds <= 0) return state;
      elapsed += milliseconds * state.speed;
      const step = steps[state.index]!;
      if (elapsed >= duration(step) - 1e-6) return tour.next();
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
  };
  return tour;
}
