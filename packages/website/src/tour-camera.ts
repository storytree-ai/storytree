/** Capability 2 · The forest on the site. The tour's camera: where it flies as the tour moves, in what order and when. */
import type { GlobeTarget } from "@storytree/forest/view";
import { aim, flight, type CameraView, type TourDetail } from "./tour.js";

/** One pose the camera eases to over `duration` milliseconds. */
export type Stop = { target: GlobeTarget; framing: number; duration: number };
/**
 * One thing the camera does, `at` milliseconds after its move begins: fly to a stop, show the next step's globe at once
 * (`show`), or swap the globe and wait for it to be drawn (`swap`; the cues after it are timed from that moment), and say
 * it has arrived (`arrive`), from where an overview step drifts.
 */
export type Cue = { at: number; kind: "fly"; stop: Stop } | { at: number; kind: "show" | "swap" | "arrive" };

/** What the camera moves from and to, and whether the globe changes on the way. */
export type Move = {
  from: CameraView;
  to: { target: GlobeTarget; framing: number };
  /** The globe on show's whole view, where a pull back aims when the last step had no target. */
  shownOverview: GlobeTarget;
  /** The next globe's whole view, where a dive lands before it flies in. */
  overview: GlobeTarget;
  /** Chapter 2's first view, which grows in from far away. */
  first: boolean;
  /** Another project's globe replaces the one on show. */
  switching: boolean;
  /** The next globe grows from a point, so it needs no pull back and dive (2.12). */
  swells: boolean;
  reduced: boolean;
  speed: number;
};

/**
 * The camera's cues for a move (ADR-0879 D5, D7): with reduced motion it cuts; to another project's globe it pulls back
 * until the globe is small, swaps it there and dives into the new one; chapter 2's first view grows in from far away; and
 * otherwise the legs of one flight follow one another, each turning the globe and zooming at once (2.15).
 */
export function cameraCues({ from, to, shownOverview, overview, first, switching, swells, reduced, speed }: Move): Cue[] {
  const fly = (at: number, stop: Stop): Cue => ({ at, kind: "fly", stop });
  // A globe that grows from a point needs no pull back and dive: the old one gives way to the new one's point, which swells
  // where the visitor is already looking (2.12; owner, 2026-10-05: "is this really needed?").
  const shown: Cue[] = switching && (reduced || first || swells) ? [{ at: 0, kind: "show" }] : [];
  if (reduced) return [...shown, fly(switching ? 60 : 0, { ...to, duration: 0 }), { at: 0, kind: "arrive" }];
  if (switching && !first && !swells) {
    const wide = Math.max(from.framing, to.framing, 1) * 2.4;
    // The dive waits for the new globe to be drawn: a heavy globe can take longer to lay out than any fixed beat.
    return [fly(0, { target: from.target ?? shownOverview, framing: wide, duration: 900 / speed }), { at: 900 / speed, kind: "swap" },
      fly(0, { target: overview, framing: wide, duration: 0 }), fly(60 / speed, { ...to, duration: 1500 / speed }), { at: 1560 / speed, kind: "arrive" }];
  }
  // The far pose lands first (one beat), so the flight in starts from it rather than from a stale zoom.
  if (first) return [...shown, fly(0, { target: to.target, framing: to.framing * 7, duration: 0 }), fly(60, { ...to, duration: 2600 }), { at: 2660, kind: "arrive" }];
  let at = 0;
  const legs = flight(from, to).map(leg => { const cue = fly(at, { target: to.target, framing: leg.framing, duration: leg.ms / speed }); at += leg.ms / speed; return cue; });
  return [...shown, ...legs, { at, kind: "arrive" }];
}

/** One leg of an overview step's drift: to the `from`th island in turn, eighteen seconds at 1×. */
export function driftLeg(order: readonly string[], from: number, framing: number, speed: number): Stop {
  return { target: { kind: "story", story: order[from % order.length]! }, framing, duration: 18_000 / speed };
}

/** The clock the camera keeps its cues on: the page's timers, or a test's. */
export type Timers = { set(run: () => void, ms: number): unknown; clear(timer: unknown): void };
/** What the page does for the camera. */
export type CameraHost = {
  timers: Timers;
  /** The camera has arrived at the step's view (true), or has set off for the next (false). */
  arrived(yes: boolean): void;
  /** Whether the tour is still playing once the camera arrives. */
  running(): boolean;
};
/** The tour as the camera is told it, each time it changes. */
export type CameraStep = {
  tour: TourDetail;
  /** The tour as the camera last saw it. */
  before: TourDetail | undefined;
  /** The step's globe is not the one on show. */
  switching: boolean;
  to: { target: GlobeTarget; framing: number };
  overview: GlobeTarget; shownOverview: GlobeTarget;
  /** The islands an overview step drifts round, in their places' order, and the one its drift starts at. */
  driftOrder: readonly string[]; next: number;
  reduced: boolean;
  /** Aims the camera; false while the target is not drawn yet, so it is aimed at again on a later beat. */
  place(stop: Stop): boolean;
  /** Puts the step's globe on show. */
  show(): void;
};

/**
 * Plays the tour's camera: it owns the timers, and the page only tells it each step (ADR-0879 D5: the camera flies; it
 * never snaps). A new step, or a line that moves the camera within one, plays the move's cues. The same step waiting
 * freezes the drift; playing again returns to the step's view and drifts on. Flights finish.
 */
export function createCameraPlayer(host: CameraHost) {
  let from: CameraView = { framing: 1.1 }, entered = false;
  let flights: unknown[] = [], drifts: unknown[] = [];
  let dive: (() => void) | undefined;
  // Each aim supersedes any earlier one still waiting for its island to be drawn, so a late island never pulls the camera back.
  let aims = 0;
  const after = (timers: unknown[], ms: number, run: () => void) => { timers.push(host.timers.set(run, ms)); };
  const clearFlight = () => { flights.forEach(host.timers.clear); flights = []; dive = undefined; };
  const clearDrift = () => { drifts.forEach(host.timers.clear); drifts = []; };
  return {
    step({ tour, before, switching, to, overview, shownOverview, driftOrder, next, reduced, place, show }: CameraStep): void {
      const { state } = tour, speed = state.speed;
      const go = (stop: Stop, timers = flights) => { const mine = ++aims; aim(target => mine !== aims || place({ ...stop, target }), stop.target, overview, again => after(timers, 50, again)); };
      const drift = (from: number) => {
        if (!tour.step.drift || reduced) return;
        go(driftLeg(driftOrder, from, to.framing, speed), drifts);
        after(drifts, 18_000 / speed, () => drift(from + 1));
      };
      // A new step, or a line that moves the camera within one.
      const moved = !before || before.state.index !== state.index || before.state.generation !== state.generation || before.state.freePlay
        || before.state.holds.includes("exploring") || before.state.holds.includes("everything") || !entered
        || JSON.stringify(to.target) !== JSON.stringify(from.target) || to.framing !== from.framing;
      if (!moved) {
        if (!tour.running) clearDrift();
        else if (before && !before.running && tour.step.drift) { clearDrift(); go({ ...to, duration: 1400 / speed }); after(drifts, 1400 / speed, () => drift(next)); }
        return;
      }
      clearFlight(); clearDrift();
      host.arrived(false);
      const first = !entered;
      entered = true;
      const swells = typeof tour.step.growth === "object" && tour.step.growth.stage === undefined;
      const play = (cue: Cue) => {
        if (cue.kind === "fly") go(cue.stop);
        else if (cue.kind === "show") show();
        else if (cue.kind === "arrive") { host.arrived(true); if (host.running()) drift(next); }
      };
      const schedule = (cues: readonly Cue[]) => {
        const swap = cues.findIndex(cue => cue.kind === "swap");
        for (const cue of swap < 0 ? cues : cues.slice(0, swap)) if (!cue.at && cue.kind !== "arrive") play(cue); else after(flights, cue.at, () => play(cue));
        if (swap >= 0) after(flights, cues[swap]!.at, () => { dive = () => schedule(cues.slice(swap + 1)); show(); });
      };
      schedule(cameraCues({ from, to, shownOverview, overview, first, switching, swells, reduced, speed }));
      from = to;
    },
    /** Whether a swapped globe is awaited, so the camera dives once it is drawn. */
    get diving(): boolean { return dive !== undefined; },
    /** The swapped globe is drawn: the camera dives into it. */
    drawn(): void { const waiting = dive; dive = undefined; waiting?.(); },
    /** The drift stops where it is (the visitor exploring, or every surface shown). */
    freeze(): void { clearDrift(); },
    /** Whatever the camera was doing stops: the visitor took the globe. */
    cancel(): void { clearFlight(); clearDrift(); },
    /** The next view grows in from far away, as chapter 2's first does once chapter 1 hands over. */
    reenter(): void { entered = false; },
  };
}
export type CameraPlayer = ReturnType<typeof createCameraPlayer>;
