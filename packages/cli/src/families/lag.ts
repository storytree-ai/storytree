/**
 * Capability 1 · Front door. `storytree lag`: what the desktop app's own recorder kept of each named action's lag on this
 * computer, read back against the budgets, a thin front door over Lag in real use. It reads a file in the storytree home and
 * needs no project or library.
 */
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const read: Verb = {
  name: "lag",
  usage: "lag",
  summary: "each named action's response, longest frame and settled time over the last 7 days, against its budget, worst first",
  async act(args) {
    if (args.words.length || args.names.length) throw new Refusal("usage: storytree lag", { code: 2 });
    const { lagReportText } = await import("@storytree/lag-in-use");
    return { text: lagReportText() };
  },
};

export const lag: Family = {
  name: "lag",
  summary: "how fast the desktop app answered you, by named action (read only)",
  verbs: [],
  bare: read,
};
