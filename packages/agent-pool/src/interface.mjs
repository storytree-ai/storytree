// Capability 3 · The agent runner's declared interface (ADR-1216 D3, ADR-1112): the entries its manifest declares
// (`storytree.declares`), which its dependents reach it by, never a path into its package: the ready pool
// (`./launch`, whose `ready` says what the pool would start) and the lane runner (`./runner`, whose `run` runs one lane).
// While this computer's settings switch the part off and name a factory plugin standing in for it, an entry is the
// stand-in's export of the same name; switched off with none, it answers nothing, said with why.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { pluginExport } from "@storytree/plugin-loader";
import { readPartsOff, readStandIns, storytreeHome } from "@storytree/project-and-caller";

/** The agent runner's part name, as the part switch names it. */
export const PART = "agent-pool";

const PACKAGE = new URL("../package.json", import.meta.url);
const own = JSON.parse(readFileSync(PACKAGE, "utf8"));

/** The entries the agent runner declares as its interface. */
export const DECLARED = own.storytree.declares;

/** The file that answers the agent runner's declared entry `from` on the computer whose storytree home is `home`. */
export function agentRunnerEntry(from, home = storytreeHome()) {
  if (!DECLARED.includes(from)) throw new Error(`the agent runner declares no ${JSON.stringify(from)} in its interface; it declares ${DECLARED.join(", ")}`);
  if (!readPartsOff(home).includes(PART)) return fileURLToPath(new URL(own.exports[from], PACKAGE));
  const { folder, plugins } = readStandIns(home);
  const plugin = plugins[PART];
  if (plugin === undefined) throw new Error(`${PART} is switched off on this computer and no factory plugin stands in for it, so nothing answers its ${from}`);
  return pluginExport(folder, plugin, from);
}
