// Capability 5 · Library tools. Which main commit a run of .github/workflows/own-health.yml records, and the CI run
// whose Windows and macOS evidence it may credit (ADR-0744 D3). The workflow's first step calls this through
// actions/github-script, so `github` is its Octokit.
//
// Each merge reaches main through the merge queue (ADR-0796), whose `merge_group` run tests the very commit main is
// fast-forwarded to. Main's own push run of that commit is usually cancelled by the next merge, so a passing queue run of
// the exact commit is that commit's CI evidence as much as a passing push run is: without it, own health recorded
// nothing between quiet spells, and the health worklist offered contracts main already tests (friction_5db47b562400).
// A pull request's run never counts: it tested the branch merged with an older main, not main's commit.

/** The prefix of the branch the merge queue tests main's next commit on. */
const QUEUE = "gh-readonly-queue/main/";

/** Whether `run` is a passing CI run of `sha` as main has it: main's push run, or the merge queue's run of that commit. */
function passedAsMain(run, sha) {
  return run?.head_sha === sha && run.conclusion === "success" &&
    ((run.event === "push" && run.head_branch === "main") || (run.event === "merge_group" && String(run.head_branch).startsWith(QUEUE)));
}

/**
 * The commit to record and the passing run to credit, given the commit whose CI finished (`own`), main's head, and the
 * run that triggered this (`triggering`, absent for a run by hand). `own` is recorded when it is main's head or has a
 * passing run of its own; otherwise main's newest passing push run at or after it, or nothing. `sha` is undefined when
 * nothing is to be recorded; `run` is undefined when the commit has no passing run to credit.
 * @returns {Promise<{ sha?: string, run?: { id: number, run_attempt: number }, notices: string[] }>}
 */
export async function chooseRecording({ github, repo, own, mainHead, triggering }) {
  const passing = async (filter) => (await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: "ci.yml", status: "success", per_page: 20, ...filter })).data.workflow_runs;
  const notices = [];
  let atOwn = passedAsMain(triggering, own) ? triggering : undefined;
  try {
    atOwn ??= (await passing({ head_sha: own })).find((run) => passedAsMain(run, own));
  } catch (error) {
    notices.push(`Could not look for CI evidence at ${own}: ${error.message}`);
  }
  if (atOwn !== undefined || mainHead === own) {
    if (atOwn === undefined) notices.push(`No passing CI evidence for ${own}; Windows-only and macOS-only contracts receive no credit.`);
    return { sha: own, run: atOwn, notices };
  }
  const [newest] = await passing({ branch: "main", event: "push", per_page: 1 });
  const status = newest === undefined ? "none" : newest.head_sha === own ? "identical"
    : (await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${own}...${newest.head_sha}` })).data.status;
  if (status !== "ahead" && status !== "identical") {
    return { notices: [...notices, `Main has moved beyond ${own}, which has no passing CI run, and no passing main commit is at or after it; this run records nothing.`] };
  }
  notices.push(`Main has moved beyond ${own}, which has no passing CI run; recording ${newest.head_sha}, main's newest commit whose CI passed.`);
  return { sha: newest.head_sha, run: newest, notices };
}
