// From the checkout root: node --import tsx packages/website/src/refresh-forest.ts --from <ISO> --to <ISO>
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { route, openNamedProject, openActivityLog } from "@storytree/agent-link";
import { connect } from "@storytree/library";
import { readCodeSurvey } from "@storytree/forest/code-survey";
import { refreshTourSnapshot } from "./tour-snapshot.js";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
if (!values.from || !values.to || !Number.isFinite(Date.parse(values.from)) || !Number.isFinite(Date.parse(values.to)) || Date.parse(values.from) >= Date.parse(values.to)) {
  throw new Error("Give --from and --to ISO timestamps for the recording's half-open window (from inclusive, to exclusive).");
}
const routed = route(process.cwd());
if (routed.status !== "routed") throw new Error(routed.message);
const server = await connect(routed.library);
try {
  const library = await openNamedProject(server, routed.project, routed.identity);
  const activity = await openActivityLog(server);
  try {
    await refreshTourSnapshot(fileURLToPath(new URL("./forest-snapshot.json", import.meta.url)), async () => {
      const [tree, history, log, arcs, holds] = await Promise.all([
        library.projectTree(), library.changesSince(0), activity.since(routed.project, 0), library.arcViews(), library.holds(),
      ]);
      const survey = await readCodeSurvey(routed.folder, tree);
      const cloudProject = routed.library.cloudSql?.instance.split(":")[0];
      return { project: routed.project, capturedAt: new Date().toISOString(), window: { from: values.from!, to: values.to! },
        cloudProjectIds: cloudProject ? [cloudProject] : [], tree, changes: history.changes, lines: log.lines, survey, arcs, holds };
    });
  } finally { await activity.close(); }
} finally { await server.close(); }
console.log("Saved scrubbed tour records and dated recording. Recapture the still before publishing.");
