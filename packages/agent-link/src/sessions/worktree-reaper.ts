import type { MergeContext } from "../claims/merges.js";

export interface ReapWatch {
  readonly everyMs?: number;
  readonly protect?: readonly string[];
  readonly empty?: (trash: string) => void;
}

export async function reapWorktrees(_context: MergeContext, _watch: ReapWatch = {}): Promise<string[]> {
  return [];
}
