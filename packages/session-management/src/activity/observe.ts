/**
 * Capability 2 · Agent activity log, contract 2.5's live reading (ADR-1345 D1, D5): whether the machines sharing one library
 * share its log, read from the lines they really write. A reading passes when two or more machines wrote the project's lines
 * within the freshness and each one's latest line reads back, oldest number first; it fails otherwise. Either way it names
 * each machine that wrote in the look-back before the freshness and has gone quiet since, with its last line's time: a
 * laptop that can no longer reach the shared library goes quiet, which leaves one machine writing and fails the reading,
 * while an occasional third writer (a cloud machine, a test VM) going quiet is said but fails nothing.
 */
import type { ActivityLog, MachineTally } from "./activity-log.js";

/** A freshness as a contract's proof states it: a whole number of hours or days (`36h`, `2d`). */
const FRESHNESS = /^([1-9]\d*)([hd])$/;
const HOUR = 3_600_000;
/** How many freshnesses back a machine counts as one that has been writing, so a quiet one is named rather than missed. */
const LOOK_BACK = 4;

export interface Reading {
  readonly state: "passing" | "failing";
  /** What it saw, in a line: each machine with its count and its first and last line within the freshness, or which went quiet. */
  readonly evidence: string;
  readonly machines: readonly MachineTally[];
}

/** `freshness` in milliseconds; undefined when it is not a whole number of hours or days. */
export function freshnessMs(freshness: string): number | undefined {
  const [, count, unit] = FRESHNESS.exec(freshness) ?? [];
  return count === undefined ? undefined : Number(count) * (unit === "d" ? 24 : 1) * HOUR;
}

/** `freshness` in words: `2d` is "2 days", `1h` "1 hour". */
function said(freshness: string): string {
  const [, count = "", unit] = FRESHNESS.exec(freshness) ?? [];
  return `${count} ${unit === "d" ? "day" : "hour"}${count === "1" ? "" : "s"}`;
}

/** Read `project`'s log on `log` as of `now` for a freshness of `freshness` (as `2d`, already checked). */
export async function readTwoMachines(log: ActivityLog, project: string, freshness: string, now = new Date()): Promise<Reading> {
  const span = freshnessMs(freshness)!;
  const recentSince = new Date(now.getTime() - span).toISOString();
  const machines = await log.machineTally(project, new Date(now.getTime() - LOOK_BACK * span).toISOString(), recentSince);
  const writing = machines.filter((one) => one.recent > 0);
  const quiet = machines.filter((one) => one.recent === 0);
  const window = `in the last ${said(freshness)}`;
  const gone = quiet.map((one) => `${one.machine} wrote no line ${window} (its last at ${one.last})`).join("; ");
  if (writing.length < 2) {
    const only = writing.length === 0 ? "no machine" : `only ${writing[0]!.machine}`;
    return { state: "failing", evidence: `${gone === "" ? "" : `${gone}: `}${only} wrote ${project}'s activity log ${window}, so no two machines were seen sharing it`, machines };
  }
  const latest = await log.lines(project, { since: recentSince, has: ["machine"], latestBy: ["machine"], omit: ["command"] });
  const numbers = latest.map((line) => line.seq);
  const inOrder = numbers.every((seq, at) => at === 0 || numbers[at - 1]! < seq);
  const missing = writing.filter((one) => !latest.some((line) => line.machine === one.machine && line.seq >= one.lastSeq));
  if (!inOrder || missing.length > 0) {
    return { state: "failing", evidence: `${missing.length > 0 ? `${missing.map((one) => one.machine).join(", ")}'s latest line did not read back` : "the machines' latest lines read back out of order"} from ${project}'s activity log`, machines };
  }
  const each = writing.map((one) => `${one.machine} ${one.recent.toLocaleString("en")} line${one.recent === 1 ? "" : "s"} (${one.first} to ${one.last})`).join(", ");
  return { state: "passing", evidence: `${writing.length} machines wrote ${project}'s activity log ${window}, their latest lines read back in order: ${each}${gone === "" ? "" : `; ${gone}`}`, machines };
}
