// Capability 20 · Lane measures
import type { ModelUsage } from "../context/index.js";

interface ListPrice {
  readonly input: number;
  readonly cacheRead: number;
  readonly output: number;
}

export const LIST_PRICES: Readonly<Record<string, ListPrice>> = {
  "claude-fable-5-1": { input: 10, cacheRead: 0.25, output: 50 },
  "claude-opus-5-5": { input: 4, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheRead: 0.2, output: 10 },
  "claude-haiku-4-5": { input: 1, cacheRead: 0.1, output: 5 },
};

export function dollarsOf(bill: ReadonlyMap<string, ModelUsage>): { dollars: number } | { unpriced: string[] } {
  let dollars = 0;
  const unpriced: string[] = [];
  for (const [model, usage] of bill) {
    const price = LIST_PRICES[model];
    if (price === undefined) {
      unpriced.push(model);
      continue;
    }
    dollars += (usage.input * price.input + usage.cacheRead * price.cacheRead + usage.cacheWrite5m * price.input * 1.25
      + usage.cacheWrite1h * price.input * 2 + usage.output * price.output) / 1_000_000;
  }
  return unpriced.length === 0 ? { dollars } : { unpriced };
}
