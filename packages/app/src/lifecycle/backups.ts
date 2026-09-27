/** Not built yet (ADR-0641 D2 step 4, B1). */
import type { Storytree } from "@storytree/library";

export const BACKUP_EVERY_MS = 0;
export const BACKUPS_KEPT = 14;

export async function backUp(_options: { storytree: Storytree; projects: readonly string[]; dir: string; now?: Date; keep?: number }): Promise<string[]> {
  throw new Error("backUp is not built yet");
}
