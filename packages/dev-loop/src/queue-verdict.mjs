// Capability 7 · The gate. Whether CI's run on a push to main may stand on the merge queue's verdict (ci.yml's
// `queue-verdict` job calls this through actions/github-script, so `github` is its Octokit).
//
// Each merge reaches main through the merge queue (ADR-0796), whose `merge_group` run tests the very commit main is
// fast-forwarded to, on all three systems; retesting it on the push took 22% of runner time (increment_08dac5c25a06).
// The queue merges once that run's `verify` job passes, which can be before the run itself reads as completed, so the
// job is read, not the run's conclusion. Anything else (a direct merge with no queue run, a batch whose head differs,
// a verify not passed, an unreadable API) leaves the push to test in full.

/** The prefix of the branch the merge queue tests main's next commit on. */
const QUEUE = "gh-readonly-queue/main/";

/**
 * @returns {Promise<{ run?: { id: number, attempt: number }, reason: string }>}
 */
export async function queueVerdict({ github, repo, sha }) {
  try {
    const { data } = await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: "ci.yml", head_sha: sha, event: "merge_group", per_page: 20 });
    for (const run of data.workflow_runs) {
      if (run.head_sha !== sha || run.event !== "merge_group" || !String(run.head_branch).startsWith(QUEUE)) continue;
      const { data: { jobs } } = await github.rest.actions.listJobsForWorkflowRun({ ...repo, run_id: run.id, filter: "latest", per_page: 100 });
      if (jobs.some((job) => job.name === "verify" && job.status === "completed" && job.conclusion === "success")) {
        return { run: { id: run.id, attempt: run.run_attempt }, reason: `The merge queue's run ${run.id} (attempt ${run.run_attempt}) passed verify on ${sha}; this push stands on it.` };
      }
    }
    return { reason: `No merge-queue run passed verify on ${sha}, so this push tests it in full.` };
  } catch (error) {
    return { reason: `Could not read the merge queue's runs of ${sha} (${error.message}), so this push tests it in full.` };
  }
}
