// Capability 7 · The gate. Whether land.yml tries a refused merge-queue enqueue again.
//
// GitHub can refuse the enqueue after this run's `verify` passed on the very commit, before it has
// taken the result in, with wordings that name required checks as not yet passed:
// `Required status check "verify" is in progress` (PR #681), `... is queued` (PR #1589, and PR #1684
// run 39795272167, refused for 75 s before a later run got in after about 67 s more), `... is
// expected` (PR #1684's re-run), or `2 of 2 required status checks have not succeeded` with every
// check green (PR #1589 run 39284191451). Those alone are retried, for RETRY_WINDOW_SECONDS from the
// first try; any other refusal, or the same ones past the window, stops the job.
//
// Command line, for the land job: `node land-enqueue.mjs <seconds since the first try>` with the
// refusal on stdin; it prints what it decided and exits 0 to try again, 1 to stop.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Five minutes: four times the 75 s that PR #1684 outlasted, and inside the job's 8-minute timeout. */
export const RETRY_WINDOW_SECONDS = 300;

const NOT_YET_READ = /Required status check "[^"]+" is (in progress|queued|expected)|required status checks? (has|have) not succeeded/;

/**
 * @param {string} refusal what GitHub answered the enqueue
 * @param {number} elapsedSeconds seconds since the first try
 * @returns {{ retry: boolean, reason: string }}
 */
export function enqueueDecision(refusal, elapsedSeconds) {
  if (!NOT_YET_READ.test(refusal)) {
    return { retry: false, reason: "GitHub refused the enqueue, and the refusal is not one this job retries." };
  }
  if (elapsedSeconds >= RETRY_WINDOW_SECONDS) {
    return {
      retry: false,
      reason: `GitHub still reads the required checks as not passed after ${elapsedSeconds} s of tries, although this run's verify passed them. Not enqueued; re-run this job to try again.`,
    };
  }
  return {
    retry: true,
    reason: `verify passed in this run, but GitHub still reads the required checks as not passed (${elapsedSeconds} s of ${RETRY_WINDOW_SECONDS} s): trying again.`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const decision = enqueueDecision(readFileSync(0, "utf8"), Number(process.argv[2] ?? 0));
  console.log(decision.retry ? decision.reason : `::error::${decision.reason}`);
  process.exitCode = decision.retry ? 0 : 1;
}
