// Capability 7 · Own health. Contracts whose proof is a named workflow job, not a numbered test (question_ae4c17ef04cd,
// the owner's option A): the job exercises the real behaviour on a real runner, and no test run can, so its verdict is
// what own health records for them. .github/workflows/own-health.yml's first step reads them (readJobProofs, through
// actions/github-script, so `github` is its Octokit) and hands them to `pnpm check:own-health`, which lays them over
// each story's judged verdicts (applyJobProofs) before recording.
//
// A job proves its contract when every one of its runs that ran succeeded; any failure or time-out fails it. A job that
// did not run (skipped, cancelled) is no verdict, so the contract's earlier one stands, as a contract with no test's does.

/**
 * Each contract a workflow job proves, by its story's package. `in` says which run is read: `credited`, the CI run own
 * health credits at the commit it records (main-commit.mjs), or `release`, the newest completed run of release.yml on
 * main that ran the jobs.
 */
export const JOB_PROOFS = [
  // apps/desktop/check-install.mjs, run when a change reaches the installer (ci.yml's `installer`): 4.43, and 4.46's first
  // update off a release from before the tool copies.
  { package: "app", contract: "4.43", in: "credited", job: /^installer on Windows$/ },
  { package: "app", contract: "4.46", in: "credited", job: /^installer on Windows$/ },
  // release-package.yml's legs, x64 and arm64, session open and closed; a red one holds the Windows delivery.
  { package: "app", contract: "4.45", in: "release", job: /(^|\/ )windows-update \(/ },
];

/** How many of the newest completed release runs are searched for one that ran the jobs. */
const RELEASE_RUNS = 10;

const FAILED = new Set(["failure", "timed_out"]);

/**
 * Each proof's verdict, read from the Actions API: `run` is the credited CI run ({ id, run_attempt, html_url }), or
 * undefined when there is none. A proof whose jobs did not run, or whose run could not be read, gives none; the
 * latter says why in `notices`.
 * @returns {Promise<{ proofs: { package: string, contract: string, state: "passing" | "failing", note: string }[], notices: string[] }>}
 */
export async function readJobProofs({ github, repo, run, proofs = JOB_PROOFS }) {
  const notices = [];
  const read = [];
  let releases;
  for (const proof of proofs) {
    try {
      let found;
      if (proof.in === "credited") {
        if (run === undefined) continue;
        const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({ ...repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100 });
        found = { run: run.html_url ?? `run ${run.id}`, jobs: ran(data.jobs, proof.job) };
      } else {
        releases ??= (await github.rest.actions.listWorkflowRuns({ ...repo, workflow_id: "release.yml", branch: "main", status: "completed", per_page: RELEASE_RUNS })).data.workflow_runs;
        for (const release of releases) {
          const { data } = await github.rest.actions.listJobsForWorkflowRun({ ...repo, run_id: release.id, filter: "latest", per_page: 100 });
          const jobs = ran(data.jobs, proof.job);
          if (jobs.length > 0) {
            found = { run: `${release.html_url} (commit ${String(release.head_sha).slice(0, 12)})`, jobs };
            break;
          }
        }
      }
      if (found === undefined || found.jobs.length === 0) continue;
      const failed = found.jobs.filter((job) => FAILED.has(job.conclusion));
      read.push({
        package: proof.package,
        contract: proof.contract,
        state: failed.length > 0 ? "failing" : "passing",
        note: failed.length > 0
          ? `workflow job ${failed.map(({ name, conclusion }) => `"${name}" ${conclusion}`).join(", ")} (${failed.length} of ${found.jobs.length}), ${found.run}`
          : `workflow job${found.jobs.length === 1 ? "" : "s"} ${found.jobs.map(({ name }) => `"${name}"`).join(", ")} passed, ${found.run}`,
      });
    } catch (error) {
      notices.push(`Could not read the workflow job that proves ${proof.package} ${proof.contract}: ${error.message}`);
    }
  }
  return { proofs: read, notices };
}

/** The jobs named by `pattern` that ran to a verdict: succeeded, failed or timed out. */
function ran(jobs, pattern) {
  return (jobs ?? []).filter((job) => pattern.test(job.name) && (job.conclusion === "success" || FAILED.has(job.conclusion)));
}

/**
 * Lay the job proofs of the story whose package is `name` over its judged `verdicts` (contract number -> verdict), in
 * place, and return them: a failing job fails its contract whatever its tests said; a passing one takes a contract its
 * tests left not checked, and leaves a tested verdict as it is.
 */
export function applyJobProofs(verdicts, name, proofs) {
  for (const proof of proofs) {
    const verdict = verdicts.get(proof.contract);
    if (proof.package !== name || verdict === undefined) continue;
    if (proof.state === "failing") verdicts.set(proof.contract, { number: proof.contract, state: "failing", passed: 0, failed: 1, skipped: 0, total: 1, note: proof.note });
    else if (verdict.state === "not-checked") verdicts.set(proof.contract, { number: proof.contract, state: "passing", passed: 1, failed: 0, skipped: 0, total: 1, note: proof.note });
  }
  return verdicts;
}

/** The proofs handed over in STORYTREE_JOB_PROOFS (readJobProofs' `proofs`, as JSON); anything else is none. */
export function jobProofsFrom(text) {
  try {
    const proofs = JSON.parse(text ?? "[]");
    return Array.isArray(proofs) ? proofs.filter((proof) =>
      typeof proof?.package === "string" && typeof proof.contract === "string" && ["passing", "failing"].includes(proof.state) && typeof proof.note === "string") : [];
  } catch {
    return [];
  }
}
