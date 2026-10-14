/**
 * Capability 3 · Lag report. `storytree lag`, declared here (ADR-0969 D2) and named under `verbs` in the package's manifest
 * (ADR-1033), so the command line mounts it as its `lag` family: what the desktop app's own recorder kept of each named
 * action's lag on this computer, read back against the budgets. It reads a file in the storytree home and needs no caller.
 */
import { verb, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";

const read = verb({
  command: { family: "lag", name: "lag", summary: "each named action's response, longest frame and settled time over the last 7 days, against its budget, worst first" },
  tool: { absent: "the desktop app's lag report is read from its terminal" },
  inputs: {},
  callerless: true,
  async act(_input, _place: VerbPlace) {
    const { lagReportText } = await import("./index.js");
    return { text: lagReportText() };
  },
});

/** The command line's `lag` family, 7th among `storytree`'s families. */
export const LAG_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "lag", summary: "how fast the desktop app answered you, by named action (read only)", order: 7, verbs: [], bare: read },
];
