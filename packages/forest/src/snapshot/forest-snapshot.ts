// The Forest public snapshot shared with hosts through the Node-only ./snapshot export.
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { ForestScene } from "@storytree/forest-world/scene";

/** Public drawing data only. Never serialize a library record or an activity line here. */
export interface ForestSnapshot {
  version: 1;
  capturedAt: string;
  radius: number;
  scene: ForestScene;
  spots: [string, { x: number; y: number; z: number }][];
}

/** Read completely before replacing the saved file; an offline library cannot erase it. */
export async function saveForestSnapshot(file: string, read: () => Promise<ForestSnapshot>): Promise<void> {
  const snapshot = await read();
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(snapshot) + "\n", { flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
