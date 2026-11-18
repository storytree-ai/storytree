// Capability 7 · Own health

const QUEUE = "gh-readonly-queue/main/";

const NIGHTLY = "macos-nightly.yml";

function passedAsMain(run, sha) {
  return run?.head_sha === sha && run.conclusion === "success" &&
    ((run.event === "push" && run.head_branch === "main") || (run.event === "merge_group" && String(run.head_branch).startsWith(QUEUE)));
}

export async function chooseRecording({ github, repo, own, mainHead, triggering }) {
  const passing = async (filter) => (await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: "ci.yml", status: "success", per_page: 20, ...filter })).data.workflow_runs;
  const notices = [];
  const evidenceAt = async (sha, known) => {
    try {
      const runs = (await passing({ head_sha: sha })).filter((run) => passedAsMain(run, sha));
      return runs.find((run) => run.event === "merge_group") ?? known ?? runs[0];
    } catch (error) {
      notices.push(`Could not look for CI evidence at ${sha}: ${error.message}`);
      return known;
    }
  };
  const macosAt = async (sha) => {
    try {
      const { data } = await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: NIGHTLY, status: "success", branch: "main", head_sha: sha, per_page: 1 });
      const [run] = data.workflow_runs.filter((run) => run.head_sha === sha && run.conclusion === "success" && run.head_branch === "main");
      if (run === undefined) notices.push(`No passing nightly macOS run tested ${sha}; macOS-only contracts receive no credit.`);
      return run;
    } catch (error) {
      notices.push(`Could not look for nightly macOS evidence at ${sha}: ${error.message}`);
      return undefined;
    }
  };
  const atOwn = await evidenceAt(own, passedAsMain(triggering, own) ? triggering : undefined);
  if (atOwn !== undefined || mainHead === own) {
    if (atOwn === undefined) notices.push(`No passing CI evidence for ${own}; Windows-only contracts receive no credit.`);
    return { sha: own, run: atOwn, macos: await macosAt(own), notices };
  }
  const [newest] = await passing({ branch: "main", event: "push", per_page: 1 });
  const status = newest === undefined ? "none" : newest.head_sha === own ? "identical"
    : (await github.rest.repos.compareCommitsWithBasehead({ ...repo, basehead: `${own}...${newest.head_sha}` })).data.status;
  if (status !== "ahead" && status !== "identical") {
    return { notices: [...notices, `Main has moved beyond ${own}, which has no passing CI run, and no passing main commit is at or after it; this run records nothing.`] };
  }
  notices.push(`Main has moved beyond ${own}, which has no passing CI run; recording ${newest.head_sha}, main's newest commit whose CI passed.`);
  return { sha: newest.head_sha, run: await evidenceAt(newest.head_sha, newest), macos: await macosAt(newest.head_sha), notices };
}
