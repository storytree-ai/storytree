/** Contract 4.16: GitHub holds the channel's metadata history; each installer stays on its original release. */
import { execFileSync } from "node:child_process";
import type { Library } from "@storytree/library";
import { STABLE_BRANCH } from "./release-channel.js";
import { versionAt } from "./release-source.js";
import { mergedPullRequests, pinStable, readStableManifest, type PinPorts, type StableManifest } from "./stable-pin.js";

const REPOSITORY = "storytree-ai/storytree";
export type GithubRequest = (endpoint: string, method?: string, body?: unknown) => Promise<unknown>;

function github(cwd: string): GithubRequest {
  return async (endpoint, method = "GET", body) => JSON.parse(execFileSync("gh", [
    "api", `repos/${REPOSITORY}/${endpoint}`, "--method", method,
    ...(body === undefined ? [] : ["--input", "-"]),
  ], { cwd, encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }));
}

/** A fresh tree contains metadata only. Fast-forward-only moves make competing pins mutually exclusive. */
export async function publishStable(manifest: StableManifest, bootstrap: string, expectedRef: string | undefined, api: GithubRequest): Promise<void> {
  const tree = await api("git/trees", "POST", { tree: [
    { path: "latest.yml", mode: "100644", type: "blob", content: JSON.stringify(manifest, null, 2) + "\n" },
    { path: "install-storytree.ps1", mode: "100644", type: "blob", content: bootstrap },
    { path: "README.md", mode: "100644", type: "blob", content: `${manifest.releaseNotes}\n\nPinned from ${manifest.pin.commit}. Installer bytes remain on the original development release.\n` },
  ] }) as { sha: string };
  const commit = await api("git/commits", "POST", {
    message: `Pin storytree ${manifest.version} as stable`, tree: tree.sha, parents: expectedRef ? [expectedRef] : [],
  }) as { sha: string };
  try {
    if (expectedRef) await api(`git/refs/heads/${STABLE_BRANCH}`, "PATCH", { sha: commit.sha, force: false });
    else await api("git/refs", "POST", { ref: `refs/heads/${STABLE_BRANCH}`, sha: commit.sha });
  } catch (error) {
    throw new Error(`Stable pin was not confirmed; it may have moved. Read it again before retrying. ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; id: number; size: number }[];
}

/** Thin front doors call this with their project library; all release rules stay in the app story. */
export async function pinRelease(version: string, options: { library: Pick<Library, "list">; cwd: string; preview?: boolean }): Promise<StableManifest> {
  const api = github(options.cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: options.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 }).trim();
  const asset = (release: Release, name: string) => {
    const matches = release.assets.filter(a => a.name === name);
    if (matches.length !== 1 || matches[0]!.browser_download_url !== `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`) throw new Error(`Release is missing a unique original ${name} asset`);
    return matches[0]!;
  };
  const download = (release: Release, name: string): string => {
    const selected = asset(release, name);
    return execFileSync("gh", ["api", `repos/${REPOSITORY}/releases/assets/${selected.id}`, "-H", "Accept: application/octet-stream"], {
      cwd: options.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
    });
  };
  const ports: PinPorts = {
    async previous() {
      let ref: { object: { sha: string } };
      try { ref = await api(`git/ref/heads/${STABLE_BRANCH}`) as typeof ref; }
      catch (error) {
        if (String((error as { stderr?: string }).stderr).includes("HTTP 404")) return undefined;
        throw error;
      }
      const file = await api(`contents/latest.yml?ref=${ref.object.sha}`) as { content: string; encoding: string };
      if (file.encoding !== "base64") throw new Error("Cannot read the previous stable pin");
      return { ref: ref.object.sha, manifest: readStableManifest(JSON.parse(Buffer.from(file.content, "base64").toString("utf8"))) };
    },
    async candidate(wanted) {
      const release = await api(`releases/tags/v${wanted}`) as Release;
      if (release.tag_name !== `v${wanted}` || release.draft || release.prerelease) throw new Error("Pin a published development build by its 0.3.<n> version");
      const remote = git("remote", "get-url", "origin");
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)storytree-ai\/storytree(?:\.git)?$/.test(remote)) throw new Error("Pin from a storytree checkout whose origin is storytree-ai/storytree");
      git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main", `refs/tags/v${wanted}:refs/tags/v${wanted}`);
      const commit = git("rev-parse", `v${wanted}^{commit}`);
      git("merge-base", "--is-ancestor", commit, "origin/main");
      if (versionAt(git, commit) !== wanted) throw new Error("Release tag and merged build version do not match");
      const delivery = JSON.parse(download(release, "storytree-delivery.json")) as {
        schema: number; version: string; channelSchema: number; architectures: string[];
        installer: { name: string; sha256: string; sha512: string; size: number };
      };
      if (delivery.schema !== 1 || delivery.version !== wanted || !delivery.architectures?.includes("x64") || !delivery.architectures.includes("arm64")) throw new Error("Release delivery manifest does not match the selected build");
      const installer = asset(release, `storytree-0.3-${wanted}-setup.exe`);
      if (delivery.installer.name !== installer.name || delivery.installer.size !== installer.size) throw new Error("Release installer does not match its delivery manifest");
      // The development updater's complete publication is required too; it remains untouched.
      asset(release, "latest.yml");
      return { version: wanted, commit, channelSchema: delivery.channelSchema, draft: release.draft, prerelease: release.prerelease,
        installer: { ...delivery.installer, url: installer.browser_download_url }, bootstrap: download(release, "install-storytree.ps1") };
    },
    async pullRequests(commit) {
      return mergedPullRequests(git("log", "--first-parent", "--merges", "--format=%s", commit));
    },
    increments: () => options.library.list("increment"),
    publish: (manifest, bootstrap, expected) => publishStable(manifest, bootstrap, expected, api),
    now: () => new Date().toISOString(),
  };
  return pinStable(version, ports, options.preview);
}
