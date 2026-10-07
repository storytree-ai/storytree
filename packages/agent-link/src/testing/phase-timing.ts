/** Temporary measurement for increment_d1f0dc3011fa. Removed before the PR is ready. */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import pg from "pg";

interface Sample { count: number; ms: number; max: number; }
interface Span { phase: string; queries: Map<string, Sample>; connects: Sample; }
const spans = new AsyncLocalStorage<Span[]>();
const empty = (): Sample => ({ count: 0, ms: 0, max: 0 });
function add(sample: Sample, ms: number) {
  sample.count++;
  sample.ms += ms;
  sample.max = Math.max(sample.max, ms);
}
function rounded(sample: Sample) {
  return { count: sample.count, ms: +sample.ms.toFixed(3), max: +sample.max.toFixed(3) };
}

export async function timed<T>(phase: string, body: () => Promise<T>): Promise<T> {
  const span: Span = { phase, queries: new Map(), connects: empty() };
  const start = performance.now();
  return spans.run([...(spans.getStore() ?? []), span], async () => {
    try { return await body(); }
    finally {
      console.error(`DBPROFILE ${JSON.stringify({ file: process.argv[1]?.replaceAll("\\", "/").split("/").pop(), phase, ms: +(performance.now() - start).toFixed(3), connects: rounded(span.connects), queries: [...span.queries].map(([sql, sample]) => ({ sql, ...rounded(sample) })) })}`);
    }
  });
}

// Preserve pg's callback and promise forms; count at Client, not Pool, so a query is counted once.
const client = pg.Client.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const name of ["query", "connect"]) {
  const original = client[name]!;
  client[name] = function (this: unknown, ...args: unknown[]) {
    const active = spans.getStore();
    if (!active?.length) return original.apply(this, args);
    const start = performance.now();
    const sql = name === "query"
      ? String(typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text)
        .replace(/storytree_t-[0-9a-f]{8}/g, "storytree_TEST")
        .replace(/\s+/g, " ").trim().slice(0, 200)
      : "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const ms = performance.now() - start;
      for (const span of active) {
        if (name === "connect") add(span.connects, ms);
        else {
          let sample = span.queries.get(sql);
          if (!sample) span.queries.set(sql, sample = empty());
          add(sample, ms);
        }
      }
    };
    const last = args.length - 1;
    if (typeof args[last] === "function") {
      const callback = args[last] as (...values: unknown[]) => unknown;
      args[last] = (...values: unknown[]) => { finish(); return callback(...values); };
    }
    try {
      const result = original.apply(this, args);
      if (result && typeof (result as Promise<unknown>).then === "function") return (result as Promise<unknown>).finally(finish);
      return result;
    } catch (error) { finish(); throw error; }
  };
}

let baseline: Promise<void> | undefined;
export function loopbackBaseline(url: string): Promise<void> {
  return baseline ??= (async () => {
    const connection = new pg.Client({ connectionString: url });
    await timed("baseline:connect", () => connection.connect());
    try {
      await connection.query("SELECT 1");
      await timed("baseline:50-selects", async () => {
        for (let i = 0; i < 50; i++) await connection.query("SELECT 1");
      });
    } finally { await connection.end(); }
  })();
}
