import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { AnnotatedTree, Change } from "@storytree/library";
import type { WorkStates } from "@storytree/arc-surface";
import { forestScene, growPlanet, storyNodes } from "@storytree/forest";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import type { ForestSnapshot } from "./forest-data.js";

export function forestSnapshot(tree: AnnotatedTree, history: readonly Change[], states: WorkStates, capturedAt: string): ForestSnapshot {
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("Snapshot capture time is invalid");
  const scene = forestScene(tree, history, states);
  // The globe in rows by dependency depth, as the app lays it out.
  const grown = growPlanet(storyNodes(tree, history).map(({ id, place }) => ({ story: id, place, reach: islandCoastReach(scene.islands.find(({ story }) => story === id)!) })));
  return { version: 1, capturedAt, radius: grown.radius, scene, spots: [...grown.spots] };
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
