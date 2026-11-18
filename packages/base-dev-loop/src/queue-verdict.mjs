// Capability 5 · The merge queue's CI scripts

const QUEUE = "gh-readonly-queue/main/";

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
