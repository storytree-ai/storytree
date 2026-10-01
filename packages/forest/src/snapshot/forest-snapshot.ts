// The forest's public snapshot: the picture the website bakes, drawn from the library.
// Node-only (it reads the library and writes a file), so it is the "./snapshot" export,
// never the browser-safe index.
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { locateLibrary, openActivityLog, type ActivityLog } from "@storytree/agent-link";
import { connect, type AnnotatedTree, type Change, type Library } from "@storytree/library";
import { workStates, type WorkStates } from "@storytree/arc-surface";
import { islandCoastReach } from "@storytree/forest-world/geometry";
import type { ForestScene } from "@storytree/forest-world/scene";
import { growPlanet } from "../planet-places/island-growth.js";
import { forestScene } from "../render/forest-scene.js";
import { storyNodes } from "../story-nodes/story-nodes.js";

/** Public drawing data only. Never serialize a library record or an activity line here. */
export interface ForestSnapshot {
  version: 1;
  capturedAt: string;
  radius: number;
  scene: ForestScene;
  spots: [string, { x: number; y: number; z: number }][];
}

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

/** Replace the snapshot `file` with the forest of the project `storytree`: its plan, whole history and work states, captured `now`. */
export async function refreshForest(
  file: string,
  { library, activity }: { library: Pick<Library, "projectTree" | "changesSince">; activity: Pick<ActivityLog, "since"> },
  now: () => Date = () => new Date(),
): Promise<void> {
  await saveForestSnapshot(file, async () => {
    const [tree, history, log] = await Promise.all([library.projectTree(), library.changesSince(0), activity.since("storytree", 0)]);
    return forestSnapshot(tree, history.changes, workStates(log.lines), now().toISOString());
  });
}

/** Locate and connect to this machine's library, then refresh `file` from the project `storytree`. */
export async function refreshForestFromLibrary(file: string): Promise<void> {
  const address = locateLibrary();
  if (!address.found) throw new Error("The library is unavailable; the saved forest was kept.");
  const server = await connect(address.connect);
  try {
    const library = await server.openProject("storytree");
    const activity = await openActivityLog(server);
    try {
      await refreshForest(file, { library, activity });
    } finally { await activity.close(); }
  } finally { await server.close(); }
}
