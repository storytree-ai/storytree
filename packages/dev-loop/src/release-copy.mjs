// Capability 11 · Carrying the repository to a new one (decision_57ef52a34c8e). The release copy carries
// the current alpha release (the repo's latest) and the pinned stable release (the version
// release-channel-stable's latest.yml names) from one repo to another, byte for byte. `fetch` downloads
// every asset into a folder and checks each against the SHA-256 digest GitHub gives for it, writing
// releases.json beside them, so nothing later needs the old repo; `publish` creates each release on the
// target as a draft, uploads its assets, downloads them back and compares every hash with the manifest,
// and only then publishes it (the alpha as latest). An asset that differs or is missing fails the copy and
// leaves the release a draft. `publish` writes nothing unless --apply is given.
//
//   node packages/dev-loop/src/release-copy.mjs fetch --from storytree-ai/storytree --dir <folder>
//   node packages/dev-loop/src/release-copy.mjs publish --to <owner/name> --dir <folder> [--apply]

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ghApi } from "./repo-carry.mjs";

const MANIFEST = "releases.json";

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
}

/** The real GitHub: gh api, and gh release download and upload. */
export const github = {
  api: ghApi,
  download: (repo, tag, dir) => gh(["release", "download", tag, "-R", repo, "-D", dir, "--clobber"]),
  upload: (repo, tag, paths) => gh(["release", "upload", tag, ...paths, "-R", repo, "--clobber"]),
};

function read(io, endpoint) {
  const answer = io.api(endpoint, "GET");
  if (answer.status >= 300 || answer.status === 0) throw new Error(`GET ${endpoint} failed (${answer.status})`);
  return answer.json;
}

/** A file's SHA-256, hex. */
export function sha256(file) {
  const hash = createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
}

/** The releases to carry: the pinned stable one first, then the alpha (latest); one entry if they are the same. */
function releasesToCarry(io, from) {
  const alpha = read(io, `repos/${from}/releases/latest`);
  const feed = JSON.parse(Buffer.from(read(io, `repos/${from}/contents/latest.yml?ref=release-channel-stable`).content, "base64").toString("utf8"));
  const stableTag = `v${feed.version}`;
  if (stableTag === alpha.tag_name) return [{ ...alpha, channel: "alpha" }];
  return [{ ...read(io, `repos/${from}/releases/tags/${stableTag}`), channel: "stable" }, { ...alpha, channel: "alpha" }];
}

/** Downloads both releases' assets into `dir`, checks each against GitHub's digest and size, and writes the manifest. */
export function fetchReleases(io, from, dir) {
  const releases = [];
  for (const release of releasesToCarry(io, from)) {
    const folder = path.join(dir, release.tag_name);
    io.download(from, release.tag_name, folder);
    const assets = release.assets.map((asset) => {
      const file = path.join(folder, asset.name);
      if (!existsSync(file)) throw new Error(`${release.tag_name}: ${asset.name} did not download`);
      const hash = sha256(file);
      const digest = asset.digest?.replace(/^sha256:/, "");
      if ((digest && digest !== hash) || readFileSync(file).length !== asset.size) throw new Error(`${release.tag_name}: ${asset.name} does not match the digest GitHub gives`);
      return { name: asset.name, size: asset.size, sha256: hash };
    });
    releases.push({ tag_name: release.tag_name, name: release.name, body: release.body ?? "", prerelease: release.prerelease, channel: release.channel, assets });
  }
  const manifest = { schema: 1, source: from, fetched_at: new Date().toISOString(), releases };
  writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

/** Each asset of `release` whose copy in `folder` is missing or hashes differently from the manifest. */
export function hashFailures(release, folder) {
  const failures = [];
  for (const asset of release.assets) {
    const file = path.join(folder, asset.name);
    if (!existsSync(file)) failures.push(`${asset.name} is missing from the copy`);
    else if (sha256(file) !== asset.sha256) failures.push(`${asset.name} differs from its source`);
  }
  return failures;
}

/**
 * Publishes the fetched releases on `to`: each is created as a draft at the target's default branch,
 * filled, downloaded back and hash-checked, then published. Answers what it did (or, dry, would do) per release.
 */
export function publishReleases(io, to, dir, { apply = false } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8"));
  const branch = read(io, `repos/${to}`).default_branch;
  const outcomes = [];
  for (const release of manifest.releases) {
    const existing = io.api(`repos/${to}/releases/tags/${release.tag_name}`, "GET");
    const action = existing.status === 404 ? "create" : "check";
    if (!apply) { outcomes.push({ tag_name: release.tag_name, action, assets: release.assets.length }); continue; }
    let id = existing.json?.id;
    if (action === "create") {
      const created = io.api(`repos/${to}/releases`, "POST", { tag_name: release.tag_name, target_commitish: branch, name: release.name, body: release.body, draft: true, prerelease: release.prerelease, make_latest: "false" });
      if (created.status >= 300) throw new Error(`${release.tag_name}: could not create the release on ${to} (${created.status})`);
      id = created.json.id;
      io.upload(to, release.tag_name, release.assets.map((asset) => path.join(dir, release.tag_name, asset.name)));
    }
    const back = path.join(dir, "copied", release.tag_name);
    rmSync(back, { recursive: true, force: true });
    io.download(to, release.tag_name, back);
    const extra = existsSync(back) ? readdirSync(back).filter((name) => !release.assets.some((a) => a.name === name)) : [];
    const failures = [...hashFailures(release, back), ...extra.map((name) => `${name} is on the copy but not the source`)];
    if (failures.length) throw new Error(failures.map((failure) => `${release.tag_name}: ${failure}`).join("\n"));
    const published = io.api(`repos/${to}/releases/${id}`, "PATCH", { draft: false, make_latest: release.channel === "alpha" ? "true" : "false" });
    if (published.status >= 300) throw new Error(`${release.tag_name}: could not publish the release on ${to} (${published.status})`);
    outcomes.push({ tag_name: release.tag_name, action, verified: release.assets.length });
  }
  return outcomes;
}

function main(argv) {
  const [command, ...rest] = argv;
  const flag = (name) => { const i = rest.indexOf(`--${name}`); return i === -1 ? undefined : rest[i + 1]; };
  const dir = flag("dir");
  if (!dir) throw new Error("Give --dir <folder> for the downloaded assets");
  if (command === "fetch") {
    const from = flag("from");
    if (!from) throw new Error("Give --from <owner/name>");
    const manifest = fetchReleases(github, from, dir);
    for (const r of manifest.releases) console.log(`${r.channel} ${r.tag_name}: ${r.assets.length} assets downloaded, each matching GitHub's digest`);
  } else if (command === "publish") {
    const to = flag("to");
    if (!to) throw new Error("Give --to <owner/name>");
    const apply = rest.includes("--apply");
    for (const outcome of publishReleases(github, to, dir, { apply })) {
      console.log(apply ? `${outcome.tag_name}: ${outcome.action === "create" ? "created" : "already there"}; ${outcome.verified} assets copied and hash-checked, published` : `${outcome.tag_name}: would ${outcome.action} with ${outcome.assets} assets (dry run; --apply copies)`);
    }
  } else throw new Error("Commands: fetch, publish");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
