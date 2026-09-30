/**
 * Hooks that follow main on a machine with no desktop app (contract 8.15).
 */
import type { HookCommand, Homes } from "./hooks-config.js";

export interface FollowMainOptions {
  /** The checkout the tool server runs from. */
  readonly checkout: string;
  readonly storytreeHome?: string;
  readonly homes?: Homes;
  /** How to build the agent link's commands into a folder; by default, buildBins. */
  readonly build?: (outdir: string) => Promise<unknown>;
}

export async function builtFromMain(_options: FollowMainOptions): Promise<HookCommand | undefined> {
  return undefined;
}
