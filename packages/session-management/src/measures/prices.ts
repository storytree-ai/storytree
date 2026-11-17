/**
 * Capability 20 · Lane measures: list-price dollars (contract 20.1). Anthropic's first-party list prices per million
 * tokens, as published when this was written (2026-11-17), for the models a lane runs; a cache write kept five minutes
 * costs 1.25 times the input price and one kept an hour twice it. A model not listed here has no price, so the lane's
 * dollars are unattributed rather than guessed; list a model here when lanes start running it.
 */
import type { ModelUsage } from "../context/index.js";

/** Dollars per million tokens: fresh input, cache reads and output. */
interface ListPrice {
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
}

/** Each model's list price, by the id Claude Code's transcripts name it with. */
export const LIST_PRICES: Readonly<Record<string, ListPrice>> = {
  "claude-fable-5-1": { input: 10, cacheRead: 0.25, output: 50 },
  "claude-opus-5-5": { input: 4, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.2, output: 10 },
  "claude-haiku-4-5": { input: 1, cacheRead: 0.1, output: 5 },
};

/** The list price of `model`, by its exact id or that id with a date or context suffix after it; undefined when none is listed. */
function priceOf(model: string): ListPrice | undefined {
  const exact = LIST_PRICES[model];
  if (exact !== undefined) return exact;
  const base = Object.keys(LIST_PRICES).filter((id) => model.startsWith(`${id}-`) || model.startsWith(`${id}[`)).sort((a, b) => b.length - a.length)[0];
  return base === undefined ? undefined : LIST_PRICES[base];
}

/** The dollars `bill` comes to at list price, or the models it names that have no list price. */
export function dollarsOf(bill: ReadonlyMap<string, ModelUsage>): { dollars: number } | { unpriced: string[] } {
  let dollars = 0;
  const unpriced: string[] = [];
  for (const [model, usage] of bill) {
    const price = priceOf(model);
    if (price === undefined) {
      unpriced.push(model);
      continue;
    }
    dollars += (usage.input * price.input + usage.cacheRead * price.cacheRead + usage.cacheWrite5m * price.input * 1.25
      + usage.cacheWrite1h * price.input * 2 + usage.output * price.output) / 1_000_000;
  }
  return unpriced.length === 0 ? { dollars } : { unpriced };
}
