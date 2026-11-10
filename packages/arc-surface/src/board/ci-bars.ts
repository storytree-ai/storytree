/**
 * Capability 3 · Arc surface: a pull request in CI as a two-leg bar on its arc's lane (3.34). Its checks, then the merge
 * queue, each filled by its time so far over its factory median (CI health 6.7): held at 95% and amber ("running long") from
 * the median, red at twice it ("well past: hung or flaky?"); a leg waiting to run has no fill. The 95% and 2x are Fable's
 * defaults (research_5ab97b11f915), which the owner left to the build.
 */
import type { PullState } from "@storytree/session-management/readings";

/** Each CI leg's factory median in minutes, as CI health's reading gives it (6.7): the arc surface's own copy of its shape. */
export interface CiExpected {
  readonly checks?: number;
  readonly queue?: number;
}
export interface CiLeg {
  readonly name: "checks" | "queue";
  /** Waiting to run (hatched), running, done, or not reached yet. */
  readonly phase: "waiting" | "running" | "done" | "ahead";
  /** Minutes since it started running, while it runs. */
  readonly elapsed?: number;
  /** Its factory median in minutes, while it runs and there is one. */
  readonly expected?: number;
  /** How full it is drawn, 0 to 1. */
  readonly fill: number;
  readonly tone: "on-time" | "long" | "hung";
}
export interface CiBar {
  readonly pr: number;
  readonly increment: { readonly id: string; readonly title: string };
  readonly legs: readonly [CiLeg, CiLeg];
  /** Minutes since its branch-state line was written: the last change seen, not the last look. */
  readonly seenAgo: number;
}

/** Where a running leg's fill holds from its median on. */
const HELD = 0.95;
/** Past this many times its median, a leg reads hung or flaky. */
const HUNG = 2;
const minutesSince = (at: string, now: Date) => Math.max(0, (now.getTime() - Date.parse(at)) / 60_000);

function running(name: CiLeg["name"], since: string, expected: number | undefined, now: Date): CiLeg {
  const elapsed = minutesSince(since, now);
  if (expected === undefined || expected <= 0) return { name, phase: "running", elapsed, fill: 0, tone: "on-time" };
  const share = elapsed / expected;
  return { name, phase: "running", elapsed, expected, fill: Math.min(share, HELD), tone: share >= HUNG ? "hung" : share >= 1 ? "long" : "on-time" };
}

/** A pull request in CI's two legs at `now`: the checks done once it is in the queue, the queue's leg timed from its latest joining. */
export function ciLegs(pull: PullState, expected: CiExpected, now: Date): readonly [CiLeg, CiLeg] {
  const idle = (name: CiLeg["name"], phase: "waiting" | "done" | "ahead"): CiLeg => ({ name, phase, fill: phase === "done" ? 1 : 0, tone: "on-time" });
  if (!pull.queued) {
    const checks = pull.checksSince === undefined ? idle("checks", "waiting") : running("checks", pull.checksSince, expected.checks, now);
    return [checks, idle("queue", "ahead")];
  }
  const queue = pull.queueWaiting || pull.queuedSince === undefined ? idle("queue", "waiting") : running("queue", pull.queuedSince, expected.queue, now);
  return [idle("checks", "done"), queue];
}
