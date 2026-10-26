// Capability 3 · Saved snapshot. From the checkout root: node --import tsx packages/website/src/refresh-forest.ts --from <ISO> --to <ISO> [--output <file>] [--cloud-project <id or number>]...
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openActivityLog } from "@storytree/session-management";
import { route, requireApproval, openNamedProject } from "@storytree/project-and-caller";
import { connect } from "@storytree/library";
import { readCodeSurvey } from "@storytree/forest/code-survey";
import { refreshTourSnapshot } from "./tour-snapshot.js";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" }, output: { type: "string" }, "cloud-project": { type: "string", multiple: true } } });
if (!values.from || !values.to || !Number.isFinite(Date.parse(values.from)) || !Number.isFinite(Date.parse(values.to)) || Date.parse(values.from) >= Date.parse(values.to)) {
  throw new Error("Give --from and --to ISO timestamps for the recording's half-open window (from inclusive, to exclusive).");
}
const routed = route(process.cwd());
if (routed.status !== "routed") throw new Error(routed.message);
const server = await connect(routed.library);
try {
  // A marker alone names no project: the checkout must be approved as its project's (ADR-0942 D1).
  await requireApproval(server, routed.project, routed.folder);
  const library = await openNamedProject(server, routed.project, routed.identity);
  const activity = await openActivityLog(server);
  try {
    await refreshTourSnapshot(values.output ?? fileURLToPath(new URL("./forest-snapshot.json", import.meta.url)), async () => {
      const [tree, history, log, arcs, holds] = await Promise.all([
        library.projectTree(), library.changesSince(0), activity.since(routed.project, 0), library.arcViews(), library.holds(),
      ]);
      const survey = await readCodeSurvey(routed.folder, tree);
      return { project: routed.project, capturedAt: new Date().toISOString(), window: { from: values.from!, to: values.to! },
        cloudProjectIds: values["cloud-project"] ?? [], tree, changes: history.changes, lines: log.lines, survey, arcs, holds };
    });
  } finally { await activity.close(); }
} finally { await server.close(); }
console.log("Saved scrubbed tour records and dated recording. Recapture the still before publishing.");
