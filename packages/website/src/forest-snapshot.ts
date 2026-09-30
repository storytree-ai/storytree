import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { AnnotatedTree, Change } from "@storytree/library";
import type { WorkStates } from "@storytree/arc-surface";
import { forestScene, storyNodes, placeOnPackedGlobe, PLANET_RADIUS } from "@storytree/forest";
import type { ForestSnapshot } from "./forest-data.js";

export function forestSnapshot(tree: AnnotatedTree, history: readonly Change[], states: WorkStates, capturedAt: string): ForestSnapshot {
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("Snapshot capture time is invalid");
  return {
    version: 1, capturedAt, radius: PLANET_RADIUS,
    scene: forestScene(tree, history, states),
    spots: storyNodes(tree, history).map(({ id, place }) => {
      const p = placeOnPackedGlobe(place);
      return [id, { x: p.x / PLANET_RADIUS, y: p.y / PLANET_RADIUS, z: p.z / PLANET_RADIUS }];
    }),
  };
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
