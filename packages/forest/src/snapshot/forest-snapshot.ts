// Capability 3 · Story node render
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { ForestScene } from "@storytree/forest-world/scene";

export interface ForestSnapshot {
  version: 1;
  capturedAt: string;
  radius: number;
  scene: ForestScene;
  spots: [string, { x: number; y: number; z: number }][];
}

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
