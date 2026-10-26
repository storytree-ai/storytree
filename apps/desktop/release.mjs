// GitHub Actions' release front door. No builds or publication happen on import.
// Source selection runs from main; the commit main's CI verified is then checked out in the build jobs.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { releaseSource, versionAt } from "../../packages/app/src/updates/release-source.ts";
import { carriedFeed, feedVersion, PLATFORM_FEED, PLATFORM_NAME, platformsNote, releaseDelivery } from "../../packages/app/src/updates/release-carry.ts";
import { INSTALL_COMMAND, MAC_INSTALL_COMMAND, macBootstraps, windowsBootstraps } from "./delivery-assets.mjs";
import { freshPlatforms, hostPlatform, PLATFORMS, platformUploads } from "./release-assets.mjs";
import { macReleaseNote, withMacNote } from "./mac-signing.mjs";

const repository = "storytree-ai/storytree";
/** Each platform's own delivery file: Windows' manifest, and the Mac's and Linux's entries merged into it on publish. */
const OWN_DELIVERY = { windows: "storytree-delivery.json", mac: "storytree-delivery-mac.json", linux: "storytree-delivery-linux.json" };
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const output = (key, value) => appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);

function onMain(sha) {
  // A source must be reachable from main even if another merge has arrived in the meantime.
  git("merge-base", "--is-ancestor", sha, "origin/main");
}

/** Where `version` stands against GitHub's latest published release: "newer", "latest" (it is that release) or "older". */
function againstPublished(version) {
  const result = spawnSync("gh", ["api", `repos/${repository}/releases/latest`], { encoding: "utf8" });
  if (result.status !== 0) {
    if (result.stderr.includes("HTTP 404")) return "newer";
    throw new Error(result.stderr || "Could not read the latest release");
  }
  const latest = JSON.parse(result.stdout).tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(latest)) throw new Error(`Unrecognised release version: ${latest}`);
  const order = version.localeCompare(latest.slice(1), "en", { numeric: true });
  return order > 0 ? "newer" : order === 0 ? "latest" : "older";
}

// A rehearsal (release-package.yml called with rehearsal: true, ADR-1032 D3) runs the same build, signing and install
// check on a branch, so a changed workflow, script or secret is proven before a real release reads it. It must never
// touch a release, whatever its workflow says: these steps are refused before they read anything or call GitHub (4.22).
if (process.env.STORYTREE_REHEARSAL === "true" && ["source", "draft", "upload", "publish"].includes(process.argv[2])) {
  throw new Error(`A rehearsal never runs ${process.argv[2]}: it builds and checks, and publishes nothing`);
}

if (process.argv[2] === "source") {
  const run = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).workflow_run;
  const sha = releaseSource(run);
  if (sha === undefined) {
    console.log("No successful CI run on main to release.");
  } else {
    onMain(sha);
    const version = versionAt(git, sha);
    if (againstPublished(version) === "newer") {
      output("sha", sha);
      output("version", version);
    } else console.log(`${version} was already published or superseded.`);
  }
} else if (["draft", "upload", "publish"].includes(process.argv[2])) {
  const sha = process.env.RELEASE_SHA;
  const version = process.env.STORYTREE_RELEASE_VERSION;
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Missing verified release identity");
  onMain(sha);
  const standing = againstPublished(version);
  const tag = `v${version}`;
  // A release publishes once, complete, and is never written to again (4.6): a rerun of a platform that was missing
  // from it passes without uploading, and its build waits for the next version, which carries every platform's newest.
  if (standing === "latest") console.log(`${tag} is already published: a late build waits for the next version.`);
  else if (standing === "newer") {
    // A draft keeps partially uploaded releases invisible to installed clients. Reruns can finish it.
    // One job makes it before the platforms upload: two drafts can share a tag, so never race to create.
    const existing = spawnSync("gh", ["release", "view", tag, "--repo", repository, "--json", "isDraft,targetCommitish,assets"], { encoding: "utf8" });
    const release = existing.status === 0 ? JSON.parse(existing.stdout) : undefined;
    if (release !== undefined && (!release.isDraft || release.targetCommitish !== sha)) throw new Error("Release identity already belongs to another publication");
    if (process.argv[2] === "draft") {
      if (release === undefined) gh("release", "create", tag, "--repo", repository, "--target", sha, "--draft", "--title", `storytree ${version}`, "--notes", notes(INSTALL_COMMAND.trim(), MAC_INSTALL_COMMAND.trim(), sha));
    } else if (release === undefined) {
      throw new Error(`No draft release ${tag} to ${process.argv[2]}`);
    } else if (process.argv[2] === "upload") {
      const platform = hostPlatform();
      const dir = "apps/desktop/release";
      const files = platformUploads(platform, readdirSync(dir));
      const missing = PLATFORMS[platform].required(version).filter((name) => !files.includes(name));
      if (missing.length > 0) throw new Error(`Missing ${platform} release assets: ${missing.join(", ")}`);
      gh("release", "upload", tag, ...files.map((file) => path.join(dir, file)), "--repo", repository, "--clobber");
      // The draft's Mac sentence was written before the build; now say what Apple answered (contract 4.20).
      if (platform === "mac") {
        const answer = path.join(dir, "mac-notarisation.json");
        const mode = !existsSync(answer) ? "ad-hoc" : JSON.parse(readFileSync(answer, "utf8")).notarised ? "notarised" : "pending";
        editNotes(tag, (body) => withMacNote(body, mode));
      }
    } else publish(tag, version, release);
  } else console.log(`${version} was already published or superseded.`);
} else if (process.argv[2] === "rehearse") {
  // Where a real release uploads, a rehearsal only checks this runner built its platform's whole set.
  const version = process.env.STORYTREE_RELEASE_VERSION || JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
  const platform = hostPlatform();
  const files = platformUploads(platform, readdirSync("apps/desktop/release"));
  const missing = PLATFORMS[platform].required(version).filter((name) => !files.includes(name));
  if (missing.length > 0) throw new Error(`Missing ${platform} release assets: ${missing.join(", ")}`);
  // The set's names, for rehearse-publish to read with this platform's delivery file.
  writeFileSync(path.join("apps/desktop/release", `${platform}.names`), files.join("\n") + "\n");
  console.log(`Rehearsal: ${platform} built its complete set for ${version}; nothing was drafted, uploaded or published.`);
} else if (process.argv[2] === "rehearse-publish") {
  // After a rehearsal's platforms ran, what publishing would do with the ones that built (4.22): each built platform's
  // set names and delivery file are in the folder given; the newest real release supplies any carried build. Read only.
  const dir = path.resolve(process.argv[3] ?? "");
  const version = process.env.STORYTREE_RELEASE_VERSION || JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
  const names = readdirSync(dir).filter((name) => name.endsWith(".names")).flatMap((name) => readFileSync(path.join(dir, name), "utf8").split("\n").filter(Boolean));
  const { manifest, summary } = publication(`v${version}`, version, names, dir);
  console.log(`Rehearsal: ${summary} Nothing was published.`);
  console.log(JSON.stringify(manifest, null, 2));
} else throw new Error("Use source, draft, upload, publish, rehearse or rehearse-publish");

/**
 * What publishing writes (4.6), into `dir`, which holds each fresh platform's own delivery file. Every platform whose
 * build is in the release (`names`) publishes it. A platform whose build is not keeps its last good build: its feed and
 * delivery entry are carried from the newest earlier published release, and its bootstraps, which name no build, are
 * written from this checkout. It reads GitHub and changes nothing there.
 */
function publication(tag, version, names, dir) {
  const fresh = freshPlatforms(names, version);
  if (fresh.length === 0) throw new Error(`Release ${tag} has no platform's complete build`);
  const absent = Object.keys(PLATFORMS).filter((platform) => !fresh.includes(platform));
  const mine = Object.fromEntries(fresh.map((platform) => [platform, JSON.parse(readFileSync(path.join(dir, OWN_DELIVERY[platform]), "utf8"))]));
  const uploads = [];
  const carried = {};
  let earlier;
  if (absent.length > 0) {
    const from = JSON.parse(gh("api", `repos/${repository}/releases?per_page=20`)).find((r) => !r.draft && !r.prerelease && r.tag_name !== tag);
    if (!from) throw new Error(`No earlier release carries ${absent.map((p) => PLATFORM_NAME[p]).join(" or ")} for ${tag}`);
    const earlierDir = mkdtempSync(path.join(tmpdir(), "storytree-earlier-"));
    gh("release", "download", from.tag_name, "--repo", repository, "--dir", earlierDir, "--pattern", "storytree-delivery.json", ...absent.flatMap((platform) => ["--pattern", PLATFORM_FEED[platform]]));
    earlier = JSON.parse(readFileSync(path.join(earlierDir, "storytree-delivery.json"), "utf8"));
    for (const platform of absent) {
      const feed = carriedFeed(readFileSync(path.join(earlierDir, PLATFORM_FEED[platform]), "utf8"));
      carried[platform] = feedVersion(feed);
      writeFileSync(path.join(dir, PLATFORM_FEED[platform]), feed);
      uploads.push(PLATFORM_FEED[platform]);
    }
    if (absent.includes("windows")) { windowsBootstraps(dir); uploads.push("install-storytree.ps1", "install-storytree.txt", "install-storytree-alpha.txt"); }
    if (absent.includes("mac")) { macBootstraps(dir); uploads.push("install-storytree.sh", "install-storytree-mac.txt", "install-storytree-mac-alpha.txt"); }
  }
  const manifest = releaseDelivery(version, mine, earlier);
  writeFileSync(path.join(dir, "storytree-delivery.json"), JSON.stringify(manifest, null, 2) + "\n");
  uploads.push("storytree-delivery.json");
  const summary = absent.length === 0 ? `${tag} carries every platform's new build.`
    : `${tag} has no new ${absent.map((p) => PLATFORM_NAME[p]).join(" or ")} build: ${absent.map((p) => `${PLATFORM_NAME[p]} stays on ${carried[p]}`).join(", ")}.`;
  return { fresh, carried, uploads, manifest, summary };
}

/** Publishes the draft with what `publication` writes, as its last write: once published, nothing is uploaded to it. */
function publish(tag, version, release) {
  const names = release.assets.map((asset) => asset.name);
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-delivery-"));
  const fresh = freshPlatforms(names, version);
  if (fresh.length > 0) gh("release", "download", tag, "--repo", repository, "--dir", dir, ...fresh.flatMap((platform) => ["--pattern", OWN_DELIVERY[platform]]));
  const { carried, uploads, summary } = publication(tag, version, names, dir);
  console.log(summary);
  gh("release", "upload", tag, ...uploads.map((file) => path.join(dir, file)), "--repo", repository, "--clobber");
  editNotes(tag, (body) => platformsNote(body, carried));
  gh("release", "edit", tag, "--repo", repository, "--draft=false", "--latest");
  output("mac", String(fresh.includes("mac")));
  output("linux", String(fresh.includes("linux")));
}

function editNotes(tag, change) {
  const body = gh("release", "view", tag, "--repo", repository, "--json", "body", "--jq", ".body");
  const notesFile = path.join(mkdtempSync(path.join(tmpdir(), "storytree-notes-")), "notes.md");
  writeFileSync(notesFile, change(body));
  gh("release", "edit", tag, "--repo", repository, "--notes-file", notesFile);
}

/** The release page's text: how to install first, since a first user may arrive here from anywhere. */
function notes(command, macCommand, sha) {
  return [
    "## Install",
    "",
    "Needs Windows (x64 or arm64) and Claude Code or Codex, installed and signed in. In PowerShell, run:",
    "",
    "```powershell",
    command,
    "```",
    "",
    "On an Apple Silicon Mac or x64 Linux (Linux Mint 22 or Ubuntu 24.04 and later), in a terminal, run:",
    "",
    "```sh",
    macCommand,
    "```",
    "",
    "It installs the app and opens it; Help → First-run guide in the app connects your agent.",
    "",
    `Windows installers, one per architecture (\`windows-x64-setup.exe\` for most PCs, \`windows-arm64-setup.exe\` for ARM PCs such as Snapdragon laptops; the one-liner picks for you), built from verified merged main ${sha}. First-user delivery follows only the owner's stable pin; it is unavailable until the first pin.`,
    "",
    // The draft is written before the Mac build, so the workflow says whether its certificate is set; the Mac upload
    // replaces this with Apple's answer.
    macReleaseNote(process.env.STORYTREE_MAC_SIGNED === "true" ? "pending" : "ad-hoc"),
    "",
    "Alpha installations follow every published build. To install alpha explicitly, use the command in install-storytree-alpha.txt (Windows) or install-storytree-mac-alpha.txt (Mac and Linux). Existing installations retain their channel.",
  ].join("\n");
}
