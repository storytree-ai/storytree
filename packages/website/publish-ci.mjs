// The thin Actions front door. Selection runs from trusted main, never PR artifacts or code.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { LIVE_VERSION, publicationBase, publicationSource, REPOSITORY, websiteChanged } from "./src/publish-source.ts";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const api = endpoint => JSON.parse(execFileSync("gh", ["api", `repos/${REPOSITORY}/${endpoint}`], { encoding: "utf8" }));
const ancestor = (commit, of) => {
  try {
    git("merge-base", "--is-ancestor", commit, of);
    return true;
  } catch {
    return false;
  }
};
async function liveVersion() {
  try {
    const response = await fetch(LIVE_VERSION, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}
const changed = (before, after) => git("diff", "--name-only", "--no-renames", before, after, "--").split("\n");

function currentInputs(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Missing verified merge commit.");
  git("merge-base", "--is-ancestor", sha, "origin/main");
  if (websiteChanged(changed(sha, "origin/main"))) {
    console.log("Skipping website publication: newer website inputs are already on main.");
    return false;
  }
  return true;
}

async function source() {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error("Wrong publishing repository.");
  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    if (process.env.GITHUB_REF !== "refs/heads/main") return undefined;
    return git("rev-parse", "origin/main");
  }
  const { workflow_run: run } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (!run || run.conclusion !== "success" || run.head_repository?.full_name !== REPOSITORY) return undefined;
  let sha = publicationSource(run);
  if (run.event === "pull_request") {
    // The run's PR list can be empty after merge. Match its tested head through the API.
    // Auto-merge may finish just after the final CI job ends; allow that short delay.
    for (let attempt = 0; attempt < 12 && !sha; attempt++) {
      const candidates = api(`commits/${run.head_sha}/pulls`);
      for (const candidate of candidates) {
        sha = publicationSource(run, api(`pulls/${candidate.number}`));
        if (sha) break;
      }
      if (!sha && attempt < 11) await setTimeout(5000);
    }
  }
  if (!sha) return undefined;
  const base = publicationBase(sha, await liveVersion(), commit => ancestor(commit, sha));
  if (!websiteChanged(changed(base, sha))) {
    console.log(`Skipping website publication: no website build inputs changed from ${base} to this merge.`);
    return undefined;
  }
  return sha;
}

if (process.argv[2] === "source") {
  const sha = await source();
  if (sha && currentInputs(sha)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
    console.log(`Selected website merge ${sha}.`);
  } else if (!sha) console.log("No eligible merged website change to publish.");
} else if (process.argv[2] === "publish") {
  const { publishWebsite } = await import("./src/publish.ts");
  const options = { directory: fileURLToPath(new URL("./dist/", import.meta.url)), token: process.env.HERENOW_TOKEN };
  const sha = process.env.WEBSITE_SHA;
  if (git("rev-parse", "HEAD") !== sha) throw new Error("Checkout does not match the selected website merge.");
  if (!options.token?.trim()) await publishWebsite(options);
  else {
    git("fetch", "--quiet", "origin", "main");
    if (currentInputs(sha)) await publishWebsite(options);
  }
} else throw new Error("Use source or publish.");
