// Capability 3 · Arc surface.
import type { PullState } from "@storytree/session-management/readings";

export interface CiEstimate {
  readonly pull: number;
  readonly checks: number;
  readonly system?: string;
  readonly full: boolean;
  readonly packages: readonly string[];
}
export interface CiExpected {
  readonly checks?: number;
  readonly queue?: number;
  readonly pulls?: readonly CiEstimate[];
}
export interface CiLeg {
  readonly name: "checks" | "queue";
  readonly phase: "waiting" | "running" | "done" | "ahead";
  readonly elapsed?: number;
  readonly expected?: number;
  readonly fill: number;
  readonly tone: "on-time" | "long" | "hung";
}
export interface CiBar {
  readonly pr: number;
  readonly increment: { readonly id: string; readonly title: string };
  readonly legs: readonly [CiLeg, CiLeg];
  readonly estimate?: CiEstimate;
  readonly seenAgo: number;
}

const HELD = 0.95;
const HUNG = 2;
const minutesSince = (at: string, now: Date) => Math.max(0, (now.getTime() - Date.parse(at)) / 60_000);

function running(name: CiLeg["name"], since: string, expected: number | undefined, now: Date): CiLeg {
  const elapsed = minutesSince(since, now);
  if (expected === undefined || expected <= 0) return { name, phase: "running", elapsed, fill: 0, tone: "on-time" };
  const share = elapsed / expected;
  return { name, phase: "running", elapsed, expected, fill: Math.min(share, HELD), tone: share >= HUNG ? "hung" : share >= 1 ? "long" : "on-time" };
}

export const ciEstimate = (pull: PullState, expected: CiExpected): CiEstimate | undefined => expected.pulls?.find((one) => one.pull === pull.number);

export function ciLegs(pull: PullState, expected: CiExpected, now: Date): readonly [CiLeg, CiLeg] {
  const idle = (name: CiLeg["name"], phase: "waiting" | "done" | "ahead"): CiLeg => ({ name, phase, fill: phase === "done" ? 1 : 0, tone: "on-time" });
  if (!pull.queued) {
    const checks = pull.checksSince === undefined ? idle("checks", "waiting") : running("checks", pull.checksSince, ciEstimate(pull, expected)?.checks ?? expected.checks, now);
    return [checks, idle("queue", "ahead")];
  }
  const queue = pull.queueWaiting || pull.queuedSince === undefined ? idle("queue", "waiting") : running("queue", pull.queuedSince, expected.queue, now);
  return [idle("checks", "done"), queue];
}
