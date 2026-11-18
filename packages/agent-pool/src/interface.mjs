// Capability 3 · The agent runner's declared interface (ADR-1216 D3, ADR-1112).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { pluginExport } from "@storytree/plugin-loader";
import { readPartsOff, readStandIns, storytreeHome } from "@storytree/project-and-caller";

export const PART = "agent-pool";

const PACKAGE = new URL("../package.json", import.meta.url);
const own = JSON.parse(readFileSync(PACKAGE, "utf8"));

export const DECLARED = own.storytree.declares;

export function agentRunnerEntry(from, home = storytreeHome()) {
  if (!DECLARED.includes(from)) throw new Error(`the agent runner declares no ${JSON.stringify(from)} in its interface; it declares ${DECLARED.join(", ")}`);
  if (!readPartsOff(home).includes(PART)) return fileURLToPath(new URL(own.exports[from], PACKAGE));
  const { folder, plugins } = readStandIns(home);
  const plugin = plugins[PART];
  if (plugin === undefined) throw new Error(`${PART} is switched off on this computer and no factory plugin stands in for it, so nothing answers its ${from}`);
  return pluginExport(folder, plugin, from);
}
