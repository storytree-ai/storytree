// GitHub Actions' release front door. No builds or publication happen on import.
// Source selection runs from main; the verified commit is then checked out in the build jobs.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { releaseSource, versionAt } from "../../packages/app/src/updates/release-source.ts";
import { INSTALL_COMMAND } from "./delivery-assets.mjs";
import { hostPlatform, missingAssets, platformUploads, PLATFORMS } from "./release-assets.mjs";

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
    const version = versionAt(git, sha);
    if (newerThanPublished(version)) {
      output("sha", sha);
      output("version", version);
    } else console.log(`${version} was already published or superseded.`);
  }
} else if (["draft", "upload", "publish"].includes(process.argv[2])) {
  const sha = process.env.RELEASE_SHA;
  const version = process.env.STORYTREE_RELEASE_VERSION;
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Missing verified release identity");
  onMain(sha);
  if (newerThanPublished(version)) {
    const tag = `v${version}`;
    // A draft keeps partially uploaded releases invisible to installed clients. Reruns can finish it.
    // One job makes it before the platforms upload: two drafts can share a tag, so never race to create.
    const existing = spawnSync("gh", ["release", "view", tag, "--repo", repository, "--json", "isDraft,targetCommitish,assets"], { encoding: "utf8" });
    const release = existing.status === 0 ? JSON.parse(existing.stdout) : undefined;
    if (release !== undefined && (!release.isDraft || release.targetCommitish !== sha)) throw new Error("Release identity already belongs to another publication");
    if (process.argv[2] === "draft") {
      if (release === undefined) gh("release", "create", tag, "--repo", repository, "--target", sha, "--draft", "--title", `storytree ${version}`, "--notes", notes(INSTALL_COMMAND.trim(), sha));
    } else if (release === undefined) {
      throw new Error(`No draft release ${tag} to ${process.argv[2]}`);
    } else if (process.argv[2] === "upload") {
      const platform = hostPlatform();
      const dir = "apps/desktop/release";
      const files = platformUploads(platform, readdirSync(dir));
      const missing = PLATFORMS[platform].required(version).filter((name) => !files.includes(name));
      if (missing.length > 0) throw new Error(`Missing ${platform} release assets: ${missing.join(", ")}`);
      gh("release", "upload", tag, ...files.map((file) => path.join(dir, file)), "--repo", repository, "--clobber");
    } else {
      const missing = missingAssets(release.assets.map((asset) => asset.name), version);
      if (Object.keys(missing).length > 0) throw new Error(`Release ${tag} is incomplete: ${JSON.stringify(missing)}`);
      gh("release", "edit", tag, "--repo", repository, "--draft=false", "--latest");
    }
  }
} else throw new Error("Use source, draft, upload or publish");

/** The release page's text: how to install first, since a first user may arrive here from anywhere. */
function notes(command, sha) {
  return [
    "## Install",
    "",
    "Needs Windows (x64 or arm64) and Claude Code or Codex, installed and signed in. In PowerShell, run:",
    "",
    "```powershell",
    command,
    "```",
    "",
    "It installs the app and opens it; Help → First-run guide in the app connects your agent.",
    "",
    `Windows x64 and arm64 installer, built from verified merged main ${sha}. First-user delivery follows only the owner's stable pin; it is unavailable until the first pin.`,
    "",
    "The macOS (Apple Silicon) zip and dmg are built and ad-hoc signed on the same commit, but not yet notarised: macOS refuses to open them until a release that is.",
    "",
    "Development installations follow every published build. To install development explicitly, use the command in install-storytree-development.txt. Existing installations retain their channel.",
  ].join("\n");
}
