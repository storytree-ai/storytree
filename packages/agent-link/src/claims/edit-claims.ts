import type { Library } from "@storytree/library";
import type { ActivityLog } from "../activity/index.js";
export type CapabilityLookup = (checkout: string, files: readonly string[]) => Promise<ReadonlyMap<string, string>>;
export async function claimFromEdits(_context: { log: ActivityLog; library: Library; project: string; home: string; lookup?: CapabilityLookup }): Promise<void> {}
