// Capability 2 · The store
import type { Pool } from "pg";

export const WAIT_MS = 30_000;

export interface PoolWaits {
  readonly waitMs?: number;
  readonly onWait?: (what: string) => void;
}

export function waitsOf(pool: Pool): { readonly waitMs: number; say(what: string): void } {
  const { waitMs, onWait } = pool.options as PoolWaits;
  return { waitMs: waitMs ?? WAIT_MS, say: (what) => onWait?.(what) };
}

export function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}
