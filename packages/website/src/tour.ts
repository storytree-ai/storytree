import type { GlobeSurfaces, GlobeTarget } from "@storytree/forest/view";

export type Explainer = "stories" | "capabilities" | "knowledge" | "sessions" | "arcs";
export type TourStep = {
  id: string; title: string; explainer: "opening" | Explainer; lines: string[];
  why: { number: number; title: string; reason: string }[];
  surfaces: Partial<GlobeSurfaces>; target?: GlobeTarget; framing?: number;
  panel?: "stories" | "arcs" | "sessions" | "knowledge";
  comparisons?: { name: string; claim: string; url: string }[];
};
export type TourState = {
  index: number; generation: number; lines: number; paused: boolean; speed: number;
  why: boolean; everything: boolean; freePlay: boolean; selection: "all" | Explainer;
};
export type TourDetail = { step: TourStep; state: TourState };

/** Reading time at 1×, with a short floor even for a two-word line. */
export const readingTime = (text: string): number => Math.max(2800, text.trim().split(/\s+/).length / 2.6 * 1000);

export function createTour(steps: readonly TourStep[]) {
  if (!steps.length) throw new Error("A tour needs at least one step.");
  let state: TourState = { index: 0, generation: 0, lines: 1, paused: false, speed: 1, why: false, everything: false, freePlay: false, selection: "all" };
  let elapsed = 0;
  const update = (patch: Partial<TourState>) => state = { ...state, ...patch };
  const start = () => {
    elapsed = 0;
    return update({ index: Math.max(0, steps.findIndex(step => state.selection === "all" || step.explainer === state.selection)),
      generation: state.generation + 1, lines: 1, paused: false, why: false, everything: false, freePlay: false });
  };
  const next = () => {
    if (state.freePlay) return state;
    elapsed = 0;
    const index = steps.findIndex((step, index) => index > state.index && (state.selection === "all" || step.explainer === state.selection));
    return index < 0 ? update({ freePlay: true, why: false }) : update({ index, lines: 1, why: false, freePlay: false });
  };
  return {
    get state() { return state; },
    tick(milliseconds: number) {
      if (state.paused || state.why || state.everything || state.freePlay || !Number.isFinite(milliseconds) || milliseconds <= 0) return state;
      elapsed += milliseconds * state.speed;
      const step = steps[state.index]!;
      const comparisonTime = state.lines === step.lines.length && step.comparisons ? readingTime(step.comparisons.map(item => `${item.name} ${item.claim}`).join(" ")) : 0;
      if (elapsed < readingTime(step.lines[state.lines - 1]!) + comparisonTime) return state;
      // A long suspended frame never skips unread text. The next line gets its full time.
      elapsed = 0;
      return state.lines < step.lines.length ? update({ lines: state.lines + 1 }) : next();
    },
    next,
    select(selection: "all" | Explainer) { update({ selection }); return start(); },
    replay: start,
    togglePause() { return update({ paused: !state.paused }); },
    setSpeed(speed: .75 | 1 | 1.5) { return update({ speed }); },
    toggleWhy() { return update({ why: !state.why }); },
    toggleEverything() { return update({ everything: !state.everything }); },
    skip() { return update({ freePlay: true, why: false }); },
  };
}
