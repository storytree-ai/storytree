// Saves the shop's whole library record, raw, as it stands: its plan, every change with its time, and its
// activity lines (claims, landings, sessions). Run after each build session; the time-lapse export reads these
// same three things (packages/website/src/refresh-growth.ts). The output holds machine details, so it is kept
// outside the public repository; only its counts are committed.
// From the checkout root, with the laptop's library tunnelled to <port> (record-library.sh does both):
// node --import tsx packages/app-setup/evidence/shop/harness/record-library.ts --port <p> --out <file> [--project shop]
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openNamedProject, openActivityLog } from "@storytree/agent-link";
import { connect } from "@storytree/library";

const { values } = parseArgs({ options: { port: { type: "string" }, out: { type: "string" }, project: { type: "string", default: "shop" } } });
if (!values.port || !values.out) throw new Error("Give --port <tunnelled port> and --out <file>.");
const project = values.project!;
const server = await connect({ url: `postgres://postgres@127.0.0.1:${values.port}/postgres` });
try {
  const library = await openNamedProject(server, project);
  const activity = await openActivityLog(server);
  try {
    const [tree, history, log] = await Promise.all([library.projectTree(), library.changesSince(0), activity.since(project, 0)]);
    writeFileSync(values.out, JSON.stringify({ project, capturedAt: new Date().toISOString(), tree, changes: history.changes, lines: log.lines }, null, 1));
    const kinds: Record<string, number> = {};
    for (const change of history.changes) kinds[change.type] = (kinds[change.type] ?? 0) + 1;
    const stories = (tree as { stories?: { capabilities?: { contracts?: unknown[] }[] }[] }).stories ?? [];
    const capabilities = stories.flatMap((s) => s.capabilities ?? []);
    console.log(JSON.stringify({ project, capturedAt: new Date().toISOString(), stories: stories.length, capabilities: capabilities.length, contracts: capabilities.flatMap((c) => c.contracts ?? []).length, changes: history.changes.length, changesByType: kinds, activityLines: log.lines.length }));
  } finally { await activity.close(); }
} finally { await server.close(); }
