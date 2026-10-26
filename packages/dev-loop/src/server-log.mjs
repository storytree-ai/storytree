// Capability 6 · Running the tests. The test Postgres's server log across runs (increment_5297d1d7c3e7): a run's start moves the
// previous run's log aside, one deep, instead of deleting it, so the `--rerun-failed` that follows a
// red run leaves the red run's server log readable.

import { renameSync } from "node:fs";
import path from "node:path";

/**
 * Move `serverLog` to `pg.previous.log` beside it, replacing an older kept one, and return where it
 * went; undefined, and the kept one left as it was, when there is no log to keep or it cannot be
 * moved (on Windows, a live run still writing it keeps it).
 */
export function keepPreviousServerLog(serverLog) {
  const kept = path.join(path.dirname(serverLog), "pg.previous.log");
  try {
    renameSync(serverLog, kept);
    return kept;
  } catch {
    return undefined;
  }
}
