// Capability 4 · Running the tests

import { renameSync } from "node:fs";
import path from "node:path";

export function keepPreviousServerLog(serverLog) {
  const kept = path.join(path.dirname(serverLog), "pg.previous.log");
  try {
    renameSync(serverLog, kept);
    return kept;
  } catch {
    return undefined;
  }
}
