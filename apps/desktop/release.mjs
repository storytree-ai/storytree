// GitHub Actions' release front door. No builds or publication happen on import.
// Source selection runs from main; the verified commit is then checked out in the build jobs.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { releaseSource, releaseVersion } from "../../packages/app/src/updates/release-source.ts";

const repository = "storytree-ai/storytree";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const api = (endpoint) => JSON.parse(gh("api", `repos/${repository}/${endpoint}`));
const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);

function onMain(sha) {
  // A source must be reachable from main even if another merge has arrived in the meantime.
  git("merge-base", "--is-ancestor", sha, "origin/main");
}

function newerThanPublished(version) {
  const result = spawnSync("gh", ["api", `repos/${repository}/releases/latest`], { encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stderr.includes("HTTP 404")) return true;
    throw new Error(result.stderr || "Could not read the latest release");
  }
  const latest = JSON.parse(result.stdout).tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(latest)) throw new Error(`Unrecognised release version: ${latest}`);
  return version.localeCompare(latest.slice(1), "en", { numeric: true }) > 0;
}

if (process.argv[2] === "source") {
  const run = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).workflow_run;
  let sha = releaseSource(run);
  if (run.event === "pull_request" && run.conclusion === "success" && run.head_repository.full_name === repository) {
    // workflow_run.pull_requests can be empty after the automatic merge; ask by the tested head.
    const candidates = api(`commits/${run.head_sha}/pulls`);
    for (const candidate of candidates) {
      sha = releaseSource(run, api(`pulls/${candidate.number}`));
      if (sha !== undefined) break;
    }
  }
  if (sha === undefined) {
    console.log("No successfully checked merge to release.");
  } else {
    onMain(sha);
    const base = JSON.parse(git("show", `${sha}:apps/desktop/package.json`)).version;
    const version = releaseVersion(base, Number(git("rev-list", "--first-parent", "--count", sha)));
    if (newerThanPublished(version)) {
      output("sha", sha);
      output("version", version);
    } else console.log(`${version} was already published or superseded.`);
  }
} else if (process.argv[2] === "publish") {
  const sha = process.env.RELEASE_SHA;
  const version = process.env.STORYTREE_RELEASE_VERSION;
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Missing verified release identity");
  onMain(sha);
  if (newerThanPublished(version)) {
    const tag = `v${version}`;
    const dir = "apps/desktop/release";
    const files = readdirSync(dir).filter((name) => /\.(exe|blockmap|yml)$/.test(name) && name !== "builder-debug.yml" && name !== "builder-effective-config.yaml");
    if (!files.includes("latest.yml") || !files.includes(`storytree-0.3-${version}-setup.exe`)) throw new Error("Missing release feed or installer");
    // A draft keeps partially uploaded releases invisible to installed clients. Reruns can finish it.
    const existing = spawnSync("gh", ["release", "view", tag, "--repo", repository, "--json", "isDraft,targetCommitish"], { encoding: "utf8" });
    if (existing.status === 0) {
      const release = JSON.parse(existing.stdout);
      if (!release.isDraft || release.targetCommitish !== sha) throw new Error("Release identity already belongs to another publication");
    } else {
      gh("release", "create", tag, "--repo", repository, "--target", sha, "--draft", "--title", `storytree ${version}`, "--notes", `Windows x64 and arm64 installer, built from verified merged main ${sha}. The installed app follows this release feed automatically.`);
    }
    gh("release", "upload", tag, ...files.map((file) => path.join(dir, file)), "--repo", repository, "--clobber");
    gh("release", "edit", tag, "--repo", repository, "--draft=false", "--latest");
  }
} else throw new Error("Use source or publish");
