// Capability 1 · Running services
import type { Clock } from "../running/supervise.js";

export function handClock(): Clock & { move(ms: number): Promise<void> } {
  let now = 0;
  let timers: { at: number; fire: () => void }[] = [];
  return {
    now: () => now,
    after(ms, fire) {
      const timer = { at: now + ms, fire };
      timers.push(timer);
      return () => { timers = timers.filter((one) => one !== timer); };
    },
    async move(ms) {
      const to = now + ms;
      for (;;) {
        await settle();
        const next = timers.filter((one) => one.at <= to).sort((a, b) => a.at - b.at)[0];
        if (next === undefined) break;
        timers = timers.filter((one) => one !== next);
        now = next.at;
        next.fire();
      }
      now = to;
      await settle();
    },
  };
}

const settle = () => new Promise<void>((done) => setImmediate(done));

