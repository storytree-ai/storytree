/**
 * Capability 3 · Lag report. Lag in real use: what the desktop app's own recorder kept, read back. The main process's side is
 * `createLagRuntime`; the page's is `@storytree/lag-in-use/view`; `storytree lag` prints `lagReportText`.
 */
import { CATALOGUE } from "@storytree/forest/actions";

import { lagFile, readReadings, storytreeHome } from "./readings.js";
import { lagReport } from "./report.js";

export { createLagRuntime } from "./runtime.js";
export { lagFile, readReadings, storytreeHome, type KeptReading } from "./readings.js";
export { lagReport } from "./report.js";

/** The report over the readings kept in `home` (the storytree home by default), as of now. */
export function lagReportText(home: string = storytreeHome()): string {
  return lagReport(readReadings(home), { now: Date.now(), catalogue: CATALOGUE, file: lagFile(home) });
}
