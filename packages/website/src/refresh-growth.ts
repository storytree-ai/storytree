// From the checkout root, with the project's library reachable at <url> (read only):
// node --import tsx packages/website/src/refresh-growth.ts --library <postgres url> [--output <file>]
// Conduit-codex, the RealWorld site the test laptop's Codex built with storytree (packages/app-setup/evidence/first-build/conduit.md, github.md).
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openNamedProject, openActivityLog } from "@storytree/agent-link";
import { connect } from "@storytree/library";
import { refreshGrowthSnapshot } from "./conduit-growth.js";

const project = "conduit-codex", identity = "16706";
const window = { from: "2026-10-01T21:14:00.000Z", to: "2026-10-02T12:44:00.000Z" };
/** Each moment the tour grows Conduit through, from its own increment log: while each part is claimed, and just after it lands. */
const stages = [
  { id: "empty", at: "2026-10-01T21:15:00.000Z" },
  { id: "stories", at: "2026-10-01T21:16:50.000Z" },
  { id: "planned", at: "2026-10-01T21:18:38.000Z" },
  { id: "part1-building", at: "2026-10-01T21:25:00.000Z" },
  { id: "part1", at: "2026-10-01T21:32:30.000Z" },
  { id: "part2-building", at: "2026-10-01T21:55:00.000Z" },
  { id: "part2", at: "2026-10-01T21:57:20.000Z" },
  { id: "part3-building", at: "2026-10-01T22:15:00.000Z" },
  { id: "part3", at: "2026-10-01T22:21:10.000Z" },
  { id: "part4-building", at: "2026-10-01T23:00:00.000Z" },
  { id: "part5-building", at: "2026-10-01T23:50:00.000Z" },
  { id: "frontend", at: "2026-10-02T00:31:10.000Z" },
  { id: "ci", at: "2026-10-02T08:11:40.000Z" },
  { id: "backend-planned", at: "2026-10-02T09:58:00.000Z" },
  { id: "backend1-building", at: "2026-10-02T10:20:00.000Z" },
  { id: "backend1", at: "2026-10-02T10:33:10.000Z" },
  { id: "backend2-building", at: "2026-10-02T10:50:00.000Z" },
  { id: "backend3-building", at: "2026-10-02T11:20:00.000Z" },
  { id: "backend4-building", at: "2026-10-02T11:45:00.000Z" },
  { id: "backend5-building", at: "2026-10-02T12:15:00.000Z" },
  { id: "complete", at: "2026-10-02T12:38:50.000Z" },
];
const { values } = parseArgs({ options: { library: { type: "string" }, output: { type: "string" } } });
if (!values.library) throw new Error("Give --library <postgres url> for the library holding conduit-codex.");
const server = await connect({ url: values.library });
try {
  const library = await openNamedProject(server, project, identity);
  const activity = await openActivityLog(server);
  try {
    await refreshGrowthSnapshot(values.output ?? fileURLToPath(new URL("./conduit-snapshot.json", import.meta.url)), async () => {
      const [tree, history, log] = await Promise.all([library.projectTree(), library.changesSince(0), activity.since(project, 0)]);
      return { project, capturedAt: new Date().toISOString(), window, tree, changes: history.changes, lines: log.lines, stages };
    });
  } finally { await activity.close(); }
} finally { await server.close(); }
console.log("Saved Conduit's growth: its plan and each stage, replayed from its own history.");
