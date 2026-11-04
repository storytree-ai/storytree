// Capability 5 · The merge queue's CI scripts. Whether land.yml tries a refused merge-queue enqueue again.
//
// GitHub can refuse the enqueue after this run's `verify` passed on the very commit, before it has
// taken the result in, with wordings that name required checks as not yet passed:
// `Required status check "verify" is in progress` (PR #681), `... is queued` (PR #1589, and PR #1684
// run 39795272167, refused for 75 s before a later run got in after about 67 s more), `... is
// expected` (PR #1684's re-run), or `2 of 2 required status checks have not succeeded` with every
// check green (PR #1589 run 39284191451). Those alone are retried, for RETRY_WINDOW_SECONDS from the
// first try; any other refusal, or the same ones past the window, stops the job.
//
// A failed enqueue can still have enqueued the pull request: on PR #403 (run 41814666825) gh got an
// HTML page, not JSON, back (`invalid character '<' ...`) and GitHub had queued it in that run. So
// the job reads the pull request's merge-queue entry after every failure: an entry means it is
// enqueued, whatever the reply said. A reply that will not parse, with no entry, is retried like the
// refusals above.
//
// Command line, for the land job: `node land-enqueue.mjs <seconds since the first try> [<the pull
// request's mergeQueueEntry state, empty if none>]` with the reply on stdin; it prints what it
// decided and exits 0 to try again, 1 to stop, 2 when the pull request is already in the queue.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Five minutes: four times the 75 s that PR #1684 outlasted, and inside the job's 8-minute timeout. */
export const RETRY_WINDOW_SECONDS = 300;

const NOT_YET_READ = /Required status check "[^"]+" is (in progress|queued|expected)|required status checks? (has|have) not succeeded/;

/** What gh says when GitHub's reply is not JSON (an HTML error page). */
const UNPARSEABLE = /invalid character '<' looking for beginning of value|unexpected end of JSON input/;

/**
 * @param {string} refusal what GitHub answered the enqueue
 * @param {number} elapsedSeconds seconds since the first try
 * @param {string} [queueState] the pull request's mergeQueueEntry state read after the failure, empty if none
 * @returns {{ retry: boolean, enqueued: boolean, reason: string }}
 */
export function enqueueDecision(refusal, elapsedSeconds, queueState = "") {
  if (queueState) {
    return {
      retry: false,
      enqueued: true,
      reason: `The enqueue's reply was a failure, but the pull request is in the merge queue (${queueState}): enqueued.`,
    };
  }
  if (UNPARSEABLE.test(refusal)) {
    if (elapsedSeconds >= RETRY_WINDOW_SECONDS) {
      return {
        retry: false,
        enqueued: false,
        reason: `GitHub's replies to the enqueue still would not parse after ${elapsedSeconds} s of tries, and the pull request is not in the merge queue. Not enqueued; re-run this job to try again.`,
      };
    }
    return {
      retry: true,
      enqueued: false,
      reason: `GitHub's reply to the enqueue would not parse, and the pull request is not in the merge queue (${elapsedSeconds} s of ${RETRY_WINDOW_SECONDS} s): trying again.`,
    };
  }
  if (!NOT_YET_READ.test(refusal)) {
    return { retry: false, enqueued: false, reason: "GitHub refused the enqueue, and the refusal is not one this job retries." };
  }
  if (elapsedSeconds >= RETRY_WINDOW_SECONDS) {
    return {
      retry: false,
      enqueued: false,
      reason: `GitHub still reads the required checks as not passed after ${elapsedSeconds} s of tries, although this run's verify passed them. Not enqueued; re-run this job to try again.`,
    };
  }
  return {
    retry: true,
    enqueued: false,
    reason: `verify passed in this run, but GitHub still reads the required checks as not passed (${elapsedSeconds} s of ${RETRY_WINDOW_SECONDS} s): trying again.`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const decision = enqueueDecision(readFileSync(0, "utf8"), Number(process.argv[2] ?? 0), process.argv[3] ?? "");
  console.log(decision.retry || decision.enqueued ? decision.reason : `::error::${decision.reason}`);
  process.exitCode = decision.enqueued ? 2 : decision.retry ? 0 : 1;
}
