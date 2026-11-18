// Capability 1 · Writing a check
import path from "node:path";
import type { TestContext } from "node:test";

import fc from "fast-check";

import { freshSeed, NIGHTLY_FACTOR, NIGHTLY_LIMIT_MS, pinAdvice } from "./nightly.js";
import { addToTally, DEFAULT_SEEDS, overBudget, QUICK_RUNS, record, type Env } from "./quick-tier.js";

export type Why = { readonly pattern: string } | { readonly judged: string };

export interface CheckOptions {
  readonly why: Why;
  readonly seeds?: readonly number[];
  readonly runs?: number;
}

export interface CheckIo {
  readonly env?: Env;
  readonly now?: () => number;
  readonly platform?: NodeJS.Platform;
  readonly recordPath?: string;
  readonly tallyPath?: string;
  readonly timeLimitMs?: number;
}

const NUMBERED = /^(\d+\.\d+) · /;

function refusal(t: TestContext | undefined, why: Why | undefined): string | undefined {
  if (!t || typeof t.name !== "string") return "A property check runs only inside a test: pass the node:test test context it runs in.";
  if (!NUMBERED.test(t.name)) return `A property check runs only inside a numbered test, and "${t.name}" does not start with its contract number ("N.M · ").`;
  const named = (value: unknown) => typeof value === "string" && value.trim() !== "";
  if (!why || !(named((why as { pattern?: unknown }).pattern) || named((why as { judged?: unknown }).judged)))
    return 'A property check names why it exists: give why as { pattern: "<the escape pattern it guards against>" } or { judged: "<the test writer\'s reason>" }.';
  return undefined;
}

export async function propertyCheck(t: TestContext, options: CheckOptions, property: fc.IRawProperty<unknown>, io: CheckIo = {}): Promise<void> {
  const refused = refusal(t, options?.why);
  if (refused) throw new Error(refused);
  const env = io.env ?? process.env;
  const now = io.now ?? Date.now;
  const runs = options.runs ?? QUICK_RUNS;
  const nightly = env.STORYTREE_PROPERTY_TIER === "nightly";
  const replay = env.STORYTREE_PROPERTY_SEED;
  const seeds = replay !== undefined ? [Number(replay)] : nightly ? [freshSeed(DEFAULT_SEEDS)] : [...DEFAULT_SEEDS, ...(options.seeds ?? [])];
  const file = t.filePath ? path.relative(process.cwd(), t.filePath).split(path.sep).join("/") : "";
  const started = now();
  const row = { at: new Date(started).toISOString(), file, test: t.name, contract: NUMBERED.exec(t.name)?.[1], why: options.why, tier: nightly ? "nightly" : "quick", seeds, runs };

  for (const seed of seeds) {
    const details = await fc.check(property, {
      seed,
      numRuns: nightly ? runs * NIGHTLY_FACTOR : runs,
      ...(replay !== undefined && env.STORYTREE_PROPERTY_PATH ? { path: env.STORYTREE_PROPERTY_PATH } : {}),
      ...(nightly ? { interruptAfterTimeLimit: io.timeLimitMs ?? NIGHTLY_LIMIT_MS } : {}),
    });
    if (details.failed) {
      const ms = now() - started;
      if (!nightly) addToTally(ms, file, env, io.tallyPath);
      record({ ...row, ms, result: "fail", seed: details.seed, path: details.counterexamplePath }, env, io.recordPath);
      const words = [fc.defaultReportMessage(details), `Replay it alone: STORYTREE_PROPERTY_SEED=${details.seed} STORYTREE_PROPERTY_PATH=${details.counterexamplePath}`];
      if (nightly) words.push(pinAdvice(details.seed));
      throw new Error(words.join("\n"));
    }
  }

  const ms = now() - started;
  const over = nightly ? undefined : overBudget(ms, addToTally(ms, file, env, io.tallyPath), io.platform ?? process.platform);
  record({ ...row, ms, result: over ? "over-budget" : "pass" }, env, io.recordPath);
  if (over) throw new Error(over);
}
