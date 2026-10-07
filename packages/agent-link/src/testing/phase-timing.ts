/** Temporary: phase timings for increment_f5a993f5abd4's Windows profile. Never lands. */
import { performance } from "node:perf_hooks";

export async function timed<T>(phase: string, body: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await body();
  } finally {
    console.error(`PHASE ${phase} ${(performance.now() - start).toFixed(1)}`);
  }
}
