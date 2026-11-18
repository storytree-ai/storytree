// Capability 6 · CI times.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Storytree } from "@storytree/library";

import { headsOf, median, minutes, passedLongest, span, type RunRow } from "./reading.js";
import { ciTimesPool } from "./store.js";

const run = promisify(execFile);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface CiTimeMeasureReader {
  readonly measure: string;
  readonly version: number;
  sample(at: { folder: string; commit: string; tree: unknown; project: string; server: Pick<Storytree, "ownDatabase"> }): Promise<{ value: number; runs: number; spread: number } | undefined>;
}

export const CI_TIME_MEASURE_READERS: readonly CiTimeMeasureReader[] = [
  {
    measure: "measure_000000000b01",
    version: 1,
    async sample({ folder, commit, project, server }) {
      const committed = new Date((await run("git", ["show", "-s", "--format=%cI", commit], { cwd: folder })).stdout.trim());
      const db = await ciTimesPool(server);
      const { rows } = await db.query<RunRow>(
        `SELECT event, pull, head_sha, created_at, started_at, ended_at, status, conclusion, bound FROM ci_runs
          WHERE project = $1 AND event IN ('pull_request', 'merge_group') AND created_at >= $2 AND created_at < $3`,
        [project, new Date(committed.getTime() - WEEK_MS), committed],
      );
      const timed = headsOf(rows).map(passedLongest).filter((one) => one !== undefined).map((one) => minutes(span(one)));
      const value = median(timed);
      if (value === undefined) return undefined;
      return { value, runs: timed.length, spread: Math.max(...timed) - Math.min(...timed) };
    },
  },
];
