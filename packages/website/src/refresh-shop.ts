// From the checkout root, with the shop's code as a git repository (a bare mirror will do) and its library either
// reachable (read only) or as a saved record (packages/app-setup/evidence/shop/harness/record-library.sh writes one):
// node --import tsx packages/website/src/refresh-shop.ts --repository <shop git dir> (--record <file> | --library <postgres url>) [--ci <dir>] [--project <name>] [--output <file>]
// --project names the shop's project in its library: shop (the first build, the default) or shop2 (the parallel rebuild,
// packages/app-setup/evidence/shop-parallel, whose harness/record-library.sh saves its record).
// --ci names the folder of the shop's archived CI runs (runs.tsv, then run-<id>.log per run): each push run on main
// colours the stages after it finished with the verified health it recorded (ADR-0902).
// The shop: the store the test laptop's Claude Code built with storytree (packages/app-setup/evidence/shop).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Line } from "@storytree/agent-link";
import type { AnnotatedTree, ArcView, Change, Holds } from "@storytree/library";
import { refreshGrowthSnapshot } from "./conduit-growth.js";
import { ciHealth, codeAt, landings, shopStages } from "./shop-growth.js";

const { values } = parseArgs({ options: { repository: { type: "string" }, record: { type: "string" }, library: { type: "string" }, ci: { type: "string" }, project: { type: "string", default: "shop" }, output: { type: "string" } } });
const project = values.project!;
if (!values.repository || !values.record === !values.library) throw new Error("Give --repository <shop git dir>, and one of --record <saved library record> or --library <postgres url>.");

/** The library's own recorded history of the shop: its plan, every dated change and its activity lines. */
async function history(): Promise<{ capturedAt: string; tree: AnnotatedTree; changes: Change[]; lines: Line[]; arcs?: ArcView[]; holds?: Holds }> {
  if (values.record) {
    const saved = JSON.parse(await readFile(values.record, "utf8"));
    if (saved.project !== project) throw new Error(`The record is of ${saved.project}, not ${project}.`);
    return saved;
  }
  const { openNamedProject, openActivityLog } = await import("@storytree/agent-link");
  const { connect } = await import("@storytree/library");
  const server = await connect({ url: values.library! });
  try {
    const library = await openNamedProject(server, project);
    const activity = await openActivityLog(server);
    try {
      const [tree, changes, log, arcs, holds] = await Promise.all([library.projectTree(), library.changesSince(0), activity.since(project, 0), library.arcViews(), library.holds()]);
      return { capturedAt: new Date().toISOString(), tree, changes: [...changes.changes], lines: [...log.lines], arcs, holds };
    } finally { await activity.close(); }
  } finally { await server.close(); }
}

/** The shop's archived push runs on main, each with its log. */
async function ciRuns(folder: string): Promise<{ id: string; log: string }[]> {
  const rows = (await readFile(path.join(folder, "runs.tsv"), "utf8")).trim().split("\n").map(row => row.split("\t"));
  return Promise.all(rows.filter(([, event, branch]) => event === "push" && branch === "main").map(async ([id]) => ({ id: id!, log: await readFile(path.join(folder, `run-${id}.log`), "utf8") })));
}

const saved = await history();
const recorded = values.ci ? { ...saved, ...await ciHealth({ tree: saved.tree, changes: saved.changes, repository: values.repository, runs: await ciRuns(values.ci) }) } : saved;
const merges = await landings(values.repository);
const { window, stages } = shopStages(recorded.changes, recorded.lines, merges);
await refreshGrowthSnapshot(values.output ?? fileURLToPath(new URL("./shop-snapshot.json", import.meta.url)), async () => ({
  project, capturedAt: recorded.capturedAt, window, tree: recorded.tree, changes: recorded.changes, lines: recorded.lines, stages, surveyAt: codeAt(values.repository!),
  ...(recorded.arcs ? { arcs: recorded.arcs, holds: recorded.holds } : {}),
}));
console.log(`Saved the shop's growth: ${stages.length} stages from ${window.from} to ${window.to}, each with its code as it stood then.`);
