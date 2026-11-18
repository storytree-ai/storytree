// Capability 5 · The merge queue's CI scripts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RETRY_WINDOW_SECONDS = 300;

const NOT_YET_READ = /Required status check "[^"]+" is (in progress|queued|expected)|required status checks? (has|have) not succeeded/;

const UNPARSEABLE = /invalid character '<' looking for beginning of value|unexpected end of JSON input/;

const WENT_WRONG = /Something went wrong while executing your query/;

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
  if (WENT_WRONG.test(refusal)) {
    if (elapsedSeconds >= RETRY_WINDOW_SECONDS) {
      return {
        retry: false,
        enqueued: false,
        reason: `GitHub still answered the enqueue "Something went wrong while executing your query" after ${elapsedSeconds} s of tries, and the pull request is not in the merge queue. Not enqueued; re-run this job to try again.`,
      };
    }
    return {
      retry: true,
      enqueued: false,
      reason: `GitHub answered the enqueue "Something went wrong while executing your query", and the pull request is not in the merge queue (${elapsedSeconds} s of ${RETRY_WINDOW_SECONDS} s): trying again.`,
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
  const decision = enqueueDecision(readFileSync(0, "utf8"), Number(process.argv[2] ?? 0), process.argv[3]);
  console.log(decision.retry || decision.enqueued ? decision.reason : `::error::${decision.reason}`);
  process.exitCode = decision.enqueued ? 2 : decision.retry ? 0 : 1;
}
