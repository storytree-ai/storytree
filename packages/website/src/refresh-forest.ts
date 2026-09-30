// From the checkout root: node --import tsx packages/website/src/refresh-forest.ts
import { fileURLToPath } from "node:url";
import { locateLibrary, openActivityLog } from "@storytree/agent-link";
import { connect } from "@storytree/library";
import { workStates } from "@storytree/arc-surface";
import { forestSnapshot, saveForestSnapshot } from "./forest-snapshot.js";

const address = locateLibrary();
if (!address.found) throw new Error("The library is unavailable; the saved forest was kept.");
const server = await connect(address.connect);
try {
  const library = await server.openProject("storytree");
  const activity = await openActivityLog(server);
  try {
    await saveForestSnapshot(fileURLToPath(new URL("./forest-snapshot.json", import.meta.url)), async () => {
      const [tree, history, log] = await Promise.all([
        library.projectTree(), library.changesSince(0), activity.since("storytree", 0),
      ]);
      return forestSnapshot(tree, history.changes, workStates(log.lines), new Date().toISOString());
    });
  } finally { await activity.close(); }
  console.log("Saved public forest drawing. Recapture the still before publishing.");
} finally { await server.close(); }
