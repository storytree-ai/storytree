// From the checkout root: node --import tsx packages/website/src/refresh-forest.ts
import { fileURLToPath, pathToFileURL } from "node:url";
import { locateLibrary, openActivityLog, type ActivityLog } from "@storytree/agent-link";
import { connect, type Library } from "@storytree/library";
import { workStates } from "@storytree/arc-surface";
import { forestSnapshot, saveForestSnapshot } from "./forest-snapshot.js";

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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const address = locateLibrary();
  if (!address.found) throw new Error("The library is unavailable; the saved forest was kept.");
  const server = await connect(address.connect);
  try {
    const library = await server.openProject("storytree");
    const activity = await openActivityLog(server);
    try {
      await refreshForest(fileURLToPath(new URL("./forest-snapshot.json", import.meta.url)), { library, activity });
    } finally { await activity.close(); }
    console.log("Saved public forest drawing. Recapture the still before publishing.");
  } finally { await server.close(); }
}
