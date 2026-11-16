/**
 * Capability 2 · Library transactions. How long a pool's calls wait, for a free slot on the server or for the
 * project's write lock, and who hears of each wait: the pool's config carries both (project/server.ts makes it).
 */
import type { Pool } from "pg";

/**
 * How long a pool keeps asking for a connection the server refused for want of a free slot
 * (SQLSTATE 53300: too many clients, or the slots left are reserved) before it passes the refusal
 * on, and how long a write waits for another session's to finish, unless the caller bounds it
 * (waitMs). A server shared by parallel sessions frees a slot within seconds as their idle
 * connections close, so a call waits through the rush rather than failing in it.
 */
export const WAIT_MS = 30_000;

/** What a pool's config adds to pg's: how long its calls wait (waitMs) and who hears of each wait (onWait). */
export interface PoolWaits {
  readonly waitMs?: number;
  readonly onWait?: (what: string) => void;
}

/**
 * How long calls on `pool` wait, for a slot or for the write lock, and the caller's ear for each
 * wait: told once, as it starts, what the call waits for (seen 2026-10-07: commands on a full
 * storytree-pg waited minutes and said nothing).
 */
export function waitsOf(pool: Pool): { readonly waitMs: number; say(what: string): void } {
  const { waitMs, onWait } = pool.options as PoolWaits;
  return { waitMs: waitMs ?? WAIT_MS, say: (what) => onWait?.(what) };
}

/** `ms` as a person reads it: "30 s", "0.3 s". */
export function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}
