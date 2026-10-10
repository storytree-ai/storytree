// Capability 3 · Saved snapshot. From the checkout root, after `git fetch origin`, with storytree's library reachable as this checkout routes it (read only):
// node --import tsx packages/website/src/refresh-own.ts [--record <saved library record>] [--repository <git dir>] [--branch origin/main] [--output <file>]
// Storytree's own growth (ADR-0889 2.2b): its plan and notes from the library's dated history, its land from main's
// commits as they stood at each stage, for Act 2's arrival time-lapse.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Line } from "@storytree/session-management";
import type { AnnotatedTree, Change } from "@storytree/library";
import { refreshGrowthSnapshot } from "./saved-growth.js";
import { ownStages } from "./own-growth.js";
import { codeAt, landings } from "./shop-growth.js";

const project = "storytree";
const { values } = parseArgs({ options: { record: { type: "string" }, repository: { type: "string" }, branch: { type: "string" }, output: { type: "string" } } });
const repository = values.repository ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const branch = values.branch ?? "origin/main";

/** The library's own recorded history of storytree: its plan, every dated change and its activity lines. */
async function history(): Promise<{ capturedAt: string; tree: AnnotatedTree; changes: Change[]; lines: Line[] }> {
  if (values.record) {
    const saved = JSON.parse(await readFile(values.record, "utf8"));
    if (saved.project !== project) throw new Error(`The record is of ${saved.project}, not ${project}.`);
    return saved;
  }
  const { route, requireApproval, openNamedProject, openActivityLog } = await import("@storytree/session-management");
  const { connect } = await import("@storytree/library");
  const routed = route(process.cwd());
  if (routed.status !== "routed") throw new Error(routed.message);
  if (routed.project !== project) throw new Error(`This checkout routes to ${routed.project}, not ${project}.`);
  const server = await connect(routed.library);
  try {
    // A marker alone names no project: the checkout must be approved as storytree's (ADR-0942 D1).
    await requireApproval(server, routed.project, routed.folder);
    const library = await openNamedProject(server, routed.project, routed.identity);
    const activity = await openActivityLog(server);
    try {
      const [tree, changes, log] = await Promise.all([library.projectTree(), library.changesSince(0), activity.since(project, 0)]);
      return { capturedAt: new Date().toISOString(), tree, changes: [...changes.changes], lines: [...log.lines] };
    } finally { await activity.close(); }
  } finally { await server.close(); }
}

const recorded = await history();
const { window, stages } = ownStages(recorded.changes, await landings(repository, branch));
await refreshGrowthSnapshot(values.output ?? fileURLToPath(new URL("./own-snapshot.json", import.meta.url)), async () => ({
  project, capturedAt: recorded.capturedAt, window, tree: recorded.tree, changes: recorded.changes, lines: recorded.lines, stages, surveyAt: codeAt(repository, branch),
}));
console.log(`Saved storytree's own growth: ${stages.length} stages from ${window.from} to ${window.to}, each with its code as it stood then.`);
