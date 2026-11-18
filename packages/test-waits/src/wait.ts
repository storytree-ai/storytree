// Capability 2 · Waiting for a check
import { setTimeout as pause } from "node:timers/promises";

import { scaled } from "./factor.js";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface WaitOptions {
  readonly platform?: NodeJS.Platform;
  readonly clock?: Clock;
}

export const realClock: Clock = { now: () => performance.now(), sleep: (ms) => pause(ms) };

const FIRST_PAUSE_MS = 25;
const PAUSE_CAP_MS = 1000;
const QUIET_PAUSE_MS = 50;

export function nextPause(previous: number | undefined, left: number): number {
  return Math.min(previous === undefined ? FIRST_PAUSE_MS : previous * 2, PAUSE_CAP_MS, left);
}

export async function waitUntil<T>(check: () => T | Promise<T>, budgetMs: number, what: string, options: WaitOptions = {}): Promise<NonNullable<T>> {
  const { platform = process.platform, clock = realClock } = options;
  const budget = scaled(budgetMs, platform);
  const start = clock.now();
  let previous: number | undefined;
  for (;;) {
    const found = await check();
    if (found) return found as NonNullable<T>;
    const left = budget - (clock.now() - start);
    if (left <= 0) throw new Error(`gave up waiting for ${what} after ${seconds(clock.now() - start)} (a budget of ${seconds(budgetMs)}, scaled to ${seconds(budget)} here)`);
    previous = nextPause(previous, left);
    await clock.sleep(previous);
  }
}

export async function quietFor(happened: () => unknown, budgetMs: number, what: string, options: WaitOptions = {}): Promise<void> {
  const { platform = process.platform, clock = realClock } = options;
  const window = scaled(budgetMs, platform);
  const start = clock.now();
  for (;;) {
    if (await happened()) throw new Error(`${what} happened after ${seconds(clock.now() - start)}, within the ${seconds(window)} it was to stay quiet`);
    const left = window - (clock.now() - start);
    if (left <= 0) return;
    await clock.sleep(Math.min(QUIET_PAUSE_MS, left));
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
