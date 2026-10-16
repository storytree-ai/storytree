/**
 * Capability 6 · Stop rules (ADR-1064 D6). An arm stops when its verifier's share has not risen for the number of merges
 * its frozen record names, at the record's wall-clock limit from its first dispatched lane (paused time counts), or once
 * the verifier passes every test. Pausing while the real pool has ranked work waiting is the dispatcher's (dispatcher.ts):
 * a pause never stops an arm. Tokens are a measure, never a cap, so no rule reads them.
 *
 * The record holds its stop rules as written sentences, frozen before the run, so the numbers are read from those words;
 * a record that names either number in no form read here is refused rather than run without that rule.
 */
import type { Point } from "../points/points.js";
import { ExperimentRefusal, type Experiment } from "../record/record.js";

/** The rules a run applies to each arm, as its frozen record names them. */
export interface StopRules {
  /** Merges in a row without a rise in the verifier's share that stop an arm. */
  readonly flatMerges: number;
  /** The wall-clock limit from an arm's first dispatched lane, and as the record words it. */
  readonly wallClockMs: number;
  readonly wallClock: string;
}

const UNIT_MS: Readonly<Record<string, number>> = { hour: 3600_000, day: 24 * 3600_000, week: 7 * 24 * 3600_000 };

/** The stop rules `experiment`'s record names; refused, naming the missing rule, when it names one in no form read here. */
export function readStopRules(experiment: Experiment): StopRules {
  const rules = experiment.stopRules;
  const flat = rules.map((rule) => /\bnot risen for (\d+) (?:consecutive )?merges\b/i.exec(rule)).find(Boolean);
  if (!flat) throw new ExperimentRefusal("the experiment's stop rules name no flat verifier curve: a run needs a rule saying the verifier share \"has not risen for N merges\"");
  const clock = rules.filter((rule) => /\bwall-clock\b/i.test(rule)).map((rule) => /\b(\d+) (hour|day|week)s?\b/i.exec(rule)).find(Boolean);
  if (!clock) throw new ExperimentRefusal("the experiment's stop rules name no wall-clock limit: a run needs a rule naming the wall-clock limit in hours, days or weeks");
  const count = Number(clock[1]), unit = clock[2]!.toLowerCase();
  return { flatMerges: Number(flat[1]), wallClockMs: count * UNIT_MS[unit]!, wallClock: `${count} ${unit}${count === 1 ? "" : "s"}` };
}

/**
 * Why an arm stops now, or undefined while it runs on: its `points` in merge order, its `firstLane` (when its first lane
 * was dispatched; undefined while it has had none) and `now`, in milliseconds. A merge whose verifier wrote no result
 * counts as a merge without a rise.
 */
export function stopReason({ points, rules, firstLane, now }: { points: readonly Point[]; rules: StopRules; firstLane: number | undefined; now: number }): string | undefined {
  const last = points.at(-1);
  if (last?.total !== undefined && last.total > 0 && last.passed === last.total) return `its verifier passes all ${last.total} tests (merge ${last.merge})`;
  let best = -1, flat = 0;
  for (const point of points) {
    const share = point.total ? point.passed! / point.total : undefined;
    if (share !== undefined && share > best) { best = share; flat = 0; } else flat += 1;
  }
  if (flat >= rules.flatMerges) return `its verifier share has not risen for ${flat} merges (its record stops it at ${rules.flatMerges})`;
  if (firstLane !== undefined && now - firstLane >= rules.wallClockMs) return `it reached its wall-clock limit of ${rules.wallClock} from its first lane`;
  return undefined;
}
