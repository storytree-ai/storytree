// Capability 7 · Lag report
import { CATALOGUE } from "@storytree/forest/actions";

import { lagFile, readReadings, storytreeHome } from "./readings.js";
import { lagReport } from "./report.js";

export { createLagRuntime } from "./runtime.js";
export { lagFile, readReadings, storytreeHome, type KeptReading } from "./readings.js";
export { lagReport } from "./report.js";

export function lagReportText(home: string = storytreeHome()): string {
  return lagReport(readReadings(home), { now: Date.now(), catalogue: CATALOGUE, file: lagFile(home) });
}
