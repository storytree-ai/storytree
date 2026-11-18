// Capability 7 · Lag report
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

export const LAG_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "lag", summary: "how fast the desktop app answered you, by named action (read only)", order: 7, verbs: [], bare: read },
];
