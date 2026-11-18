// Capability 7 · Own health

export const JOB_PROOFS = [
  { package: "app", contract: "4.43", in: "credited", job: /^installer on Windows$/ },
  { package: "app", contract: "4.46", in: "credited", job: /^installer on Windows$/ },
  { package: "app", contract: "4.45", in: "release", job: /(^|\/ )windows-update \(/ },
];

const RELEASE_RUNS = 10;

const FAILED = new Set(["failure", "timed_out"]);

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

function ran(jobs, pattern) {
  return (jobs ?? []).filter((job) => pattern.test(job.name) && (job.conclusion === "success" || FAILED.has(job.conclusion)));
}

export function applyJobProofs(verdicts, name, proofs) {
  for (const proof of proofs) {
    const verdict = verdicts.get(proof.contract);
    if (proof.package !== name || verdict === undefined) continue;
    if (proof.state === "failing") verdicts.set(proof.contract, { number: proof.contract, state: "failing", passed: 0, failed: 1, skipped: 0, total: 1, note: proof.note });
    else if (verdict.state === "not-checked") verdicts.set(proof.contract, { number: proof.contract, state: "passing", passed: 1, failed: 0, skipped: 0, total: 1, note: proof.note });
  }
  return verdicts;
}

export function jobProofsFrom(text) {
  try {
    const proofs = JSON.parse(text ?? "[]");
    return Array.isArray(proofs) ? proofs.filter((proof) =>
      typeof proof?.package === "string" && typeof proof.contract === "string" && ["passing", "failing"].includes(proof.state) && typeof proof.note === "string") : [];
  } catch {
    return [];
  }
}
