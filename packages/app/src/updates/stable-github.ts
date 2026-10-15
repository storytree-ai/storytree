/** Capability 4 · Updates. Contract 4.16: GitHub holds the channel's metadata history; each installer stays on its original release. */
import { execFileSync } from "node:child_process";
import type { Library } from "@storytree/library";
import { STABLE_BRANCH } from "./release-channel.js";
import { versionAt } from "./release-source.js";
import { stableCandidate, type PublishedBuild, type StableCandidate } from "./stable-candidate.js";
import {
  FEED_PLATFORMS, mergedPullRequests, moveStableBack, pinCoverage, pinStable, readStableManifest,
  type Bootstraps, type FeedPlatform, type PinPorts, type PlatformFeed, type PlatformFeeds, type StableManifest,
} from "./stable-pin.js";

const REPOSITORY = "storytree-ai/storytree";
export type GithubRequest = (endpoint: string, method?: string, body?: unknown) => Promise<unknown>;

function github(cwd: string): GithubRequest {
  return async (endpoint, method = "GET", body) => JSON.parse(execFileSync("gh", [
    "api", `repos/${REPOSITORY}/${endpoint}`, "--method", method,
    ...(body === undefined ? [] : ["--input", "-"]),
  ], { cwd, encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body), maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }));
}

/** A fresh tree contains metadata only. Fast-forward-only moves make competing pins mutually exclusive. */
export async function publishStable(manifest: StableManifest, bootstrap: Bootstraps, expectedRef: string | undefined, api: GithubRequest): Promise<void> {
  const tree = await api("git/trees", "POST", { tree: [
    { path: "latest.yml", mode: "100644", type: "blob", content: JSON.stringify(manifest, null, 2) + "\n" },
    { path: "install-storytree.ps1", mode: "100644", type: "blob", content: bootstrap.ps1 },
    ...(bootstrap.sh === undefined ? [] : [{ path: "install-storytree.sh", mode: "100644", type: "blob", content: bootstrap.sh }]),
    ...Object.entries(manifest.feeds ?? {}).map(([platform, feed]) => (
      { path: FEED_PLATFORMS[platform as FeedPlatform].file, mode: "100644", type: "blob", content: JSON.stringify(feed, null, 2) + "\n" })),
    { path: "README.md", mode: "100644", type: "blob", content: `${manifest.releaseNotes}\n\n${pinCoverage(manifest)}\n\nPinned from ${manifest.pin.commit}. Installer bytes remain on their original development releases.\n` },
  ] }) as { sha: string };
  const back = manifest.pin.movedBackFrom;
  const commit = await api("git/commits", "POST", {
    message: back ? `Move stable back to storytree ${manifest.version} from ${back}` : `Pin storytree ${manifest.version} as stable`, tree: tree.sha, parents: expectedRef ? [expectedRef] : [],
  }) as { sha: string };
  try {
    if (expectedRef) await api(`git/refs/heads/${STABLE_BRANCH}`, "PATCH", { sha: commit.sha, force: false });
    else await api("git/refs", "POST", { ref: `refs/heads/${STABLE_BRANCH}`, sha: commit.sha });
  } catch (error) {
    throw new Error(`Stable pin was not confirmed; it may have moved. Read it again before retrying. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reads the update feed electron-builder wrote for one platform (latest-mac.yml, latest-linux.yml) into one whose files
 * name the release's own assets by absolute URL, so a feed on the stable branch fetches them from that release.
 * Only that writer's fixed shape is read; anything else in a file entry refuses the pin rather than being dropped.
 * A feed naming another version was carried from an earlier build because the release has no new one (4.6): it is
 * no build of this release, so undefined, and the pin keeps that platform where an earlier pin put it.
 */
export function releaseFeed(text: string, resolve: (name: string) => { url: string; size: number }, release: string): PlatformFeed | undefined {
  const files: Partial<PlatformFeed["files"][number]>[] = [];
  let version: string | undefined;
  let inFiles = false;
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpExecArray | null;
    if (!line.trim()) continue;
    if ((m = /^version: '?([^'\s]+)'?$/.exec(line))) { version = m[1]; inFiles = false; }
    else if (line === "files:") inFiles = true;
    else if (inFiles && (m = /^  - url: (\S+)$/.exec(line))) files.push({ url: m[1]! });
    else if (inFiles && files.length && (m = /^    (sha512|size|blockMapSize): (\S+)$/.exec(line))) {
      const file = files.at(-1)!;
      if (m[1] === "sha512") file.sha512 = m[2]!;
      else file[m[1] as "size" | "blockMapSize"] = Number(m[2]);
    } else if (/^\S/.test(line)) inFiles = false;
    else if (inFiles) throw new Error(`Cannot read a release feed line: ${line}`);
  }
  if (!version) throw new Error("A release feed names no version");
  if (version !== release) return undefined;
  return { version, files: files.map(({ url, ...rest }) => {
    const original = resolve(url!);
    if (rest.size !== original.size) throw new Error(`Release feed size for ${url} does not match its asset`);
    return { ...rest, url: original.url } as PlatformFeed["files"][number];
  }) };
}

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; id: number; size: number }[];
}

/** The stable branch's pin commits, newest first: the version each pinned, from the message publishStable writes. */
export function pinCommits(commits: readonly { sha: string; commit: { message: string } }[]): { sha: string; version: string }[] {
  return commits.flatMap(({ sha, commit }) => {
    const m = /^(?:Pin storytree (0\.3\.[1-9]\d*) as stable|Move stable back to storytree (0\.3\.[1-9]\d*) from )/.exec(commit.message);
    return m ? [{ sha, version: (m[1] ?? m[2])! }] : [];
  });
}

async function readPin(api: GithubRequest, ref: string): Promise<StableManifest> {
  const file = await api(`contents/latest.yml?ref=${ref}`) as { content: string; encoding: string };
  if (file.encoding !== "base64") throw new Error("Cannot read the stable pin");
  return readStableManifest(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
}

/** The manifest the newest earlier pin of `version` published, or nothing when stable was never pinned to it. */
export async function formerPin(version: string, api: GithubRequest): Promise<StableManifest | undefined> {
  for (let page = 1; ; page++) {
    const commits = await api(`commits?sha=${STABLE_BRANCH}&per_page=100&page=${page}`) as { sha: string; commit: { message: string } }[];
    const found = pinCommits(commits).find(c => c.version === version);
    if (found) return readPin(api, found.sha);
    if (commits.length < 100) return undefined;
  }
}

/** The platforms a release has its own build of: Windows by its installer, the Mac and Linux by the builds their feeds name; a feed carried from an earlier build (4.6) counts for nothing. */
export function releasePlatforms(release: Pick<Release, "tag_name" | "assets">): PublishedBuild["platforms"] {
  const names = new Set(release.assets.map(a => a.name));
  const version = release.tag_name.slice(1);
  const built = (end: string) => [...names].some(n => n.startsWith(`storytree-0.3-${version}-`) && n.endsWith(end));
  return [
    ...(names.has(`storytree-0.3-${version}-setup.exe`) ? ["windows" as const] : []),
    ...(Object.keys(FEED_PLATFORMS) as FeedPlatform[]).filter(p => names.has(FEED_PLATFORMS[p].file) && built(FEED_PLATFORMS[p].build)),
  ];
}

/** A release run passed when it published the build and its Mac acceptance run passed; any rerun of it may say so. */
export function releaseRunPassed(runs: readonly { id: number; jobs: readonly { name: string; conclusion: string | null }[] }[]): { passed: boolean; evidence: string } {
  const url = (id: number) => `https://github.com/${REPOSITORY}/actions/runs/${id}`;
  const passed = (jobs: readonly { name: string; conclusion: string | null }[], match: RegExp) => jobs.some(j => match.test(j.name) && j.conclusion === "success");
  const good = runs.find(r => passed(r.jobs, /^publish$/) && passed(r.jobs, /^mac-acceptance\b/));
  if (good) return { passed: true, evidence: `Release run ${good.id} published it and its Mac acceptance run passed (${url(good.id)}).` };
  const published = runs.find(r => passed(r.jobs, /^publish$/));
  return { passed: false, evidence: published
    ? `its Mac acceptance run did not pass in release run ${published.id} (${url(published.id)})`
    : "no release run of its commit published it with every job passing" };
}

/** `storytree release candidate`: the stable candidate read from GitHub and the library; it changes nothing. */
export async function findStableCandidate(options: { library: Pick<Library, "list">; cwd: string }): Promise<StableCandidate> {
  const api = github(options.cwd);
  return stableCandidate({
    async pinned() {
      try { return await readPin(api, STABLE_BRANCH); }
      catch (error) {
        if (String((error as { stderr?: string }).stderr).includes("HTTP 404")) return undefined;
        throw error;
      }
    },
    async builds(after) {
      const floor = after ? Number(after.slice(4)) : 0;
      const builds: PublishedBuild[] = [];
      for (let page = 1; ; page++) {
        const releases = await api(`releases?per_page=100&page=${page}`) as (Release & { published_at: string | null })[];
        for (const r of releases) {
          if (r.draft || r.prerelease || !r.published_at || !/^v0\.3\.[1-9]\d*$/.test(r.tag_name)) continue;
          if (Number(r.tag_name.slice(5)) > floor) builds.push({ version: r.tag_name.slice(1), publishedAt: r.published_at, platforms: releasePlatforms(r) });
        }
        // Releases come newest first; a page reaching the pin, or a short one, is the last needed.
        const oldest = releases.filter(r => /^v0\.3\.\d+$/.test(r.tag_name)).map(r => Number(r.tag_name.slice(5)));
        if (releases.length < 100 || Math.min(...oldest) <= floor) return builds;
      }
    },
    async runs(build) {
      const { sha } = await api(`commits/v${build.version}`) as { sha: string };
      const { workflow_runs } = await api(`actions/workflows/release.yml/runs?head_sha=${sha}&per_page=20`) as { workflow_runs: { id: number; head_sha: string }[] };
      const runs = [];
      for (const run of workflow_runs.filter(r => r.head_sha === sha)) {
        runs.push({ id: run.id, jobs: (await api(`actions/runs/${run.id}/jobs?per_page=100`) as { jobs: { name: string; conclusion: string | null }[] }).jobs });
      }
      return releaseRunPassed(runs);
    },
    async concerns() {
      const text = (fields: Record<string, unknown>, names: string[]) => names.map(n => fields[n]).filter(v => typeof v === "string").join("\n");
      const [frictions, questions] = await Promise.all([options.library.list("friction"), options.library.list("question")]);
      return [
        ...frictions.filter(f => f.fields["state"] === "open" || f.fields["state"] === "routed")
          .map(f => ({ id: f.id, title: String(f.fields["title"]), text: text(f.fields, ["statement", "description", "evidence", "impact"]) })),
        ...questions.filter(q => q.fields["lifecycle"] === "open")
          .map(q => ({ id: q.id, title: String(q.fields["title"]), text: text(q.fields, ["statement", "stakes", "context"]) })),
      ];
    },
    notes: async version => (await pinRelease(version, { ...options, preview: true })).releaseNotes,
    now: () => new Date().toISOString(),
  });
}

/** Thin front doors call this with their project library; all release rules stay in the app story. */
export async function pinRelease(version: string, options: { library: Pick<Library, "list">; cwd: string; preview?: boolean; back?: boolean; expedited?: string }): Promise<StableManifest> {
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
      return { ref: ref.object.sha, manifest: await readPin(api, ref.object.sha) };
    },
    formerPin: wanted => formerPin(wanted, api),
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
      const feeds: PlatformFeeds = {};
      for (const platform of Object.keys(FEED_PLATFORMS) as FeedPlatform[]) {
        const { file } = FEED_PLATFORMS[platform];
        if (release.assets.some(a => a.name === file)) {
          const feed = releaseFeed(download(release, file), name => {
            const original = asset(release, name);
            return { url: original.browser_download_url, size: original.size };
          }, wanted);
          if (feed) feeds[platform] = feed;
        }
      }
      return { version: wanted, commit, channelSchema: delivery.channelSchema, draft: release.draft, prerelease: release.prerelease,
        installer: { ...delivery.installer, url: installer.browser_download_url }, feeds, bootstrap: {
          ps1: download(release, "install-storytree.ps1"),
          ...(release.assets.some(a => a.name === "install-storytree.sh") ? { sh: download(release, "install-storytree.sh") } : {}),
        } };
    },
    async pullRequests(commit) {
      return mergedPullRequests(git("log", "--first-parent", "--merges", "--format=%s", commit));
    },
    increments: () => options.library.list("increment"),
    publish: (manifest, bootstrap, expected) => publishStable(manifest, bootstrap, expected, api),
    now: () => new Date().toISOString(),
  };
  if (options.back && options.expedited) throw new Error("--expedited pins an urgent fix forward; --back moves stable back, and needs no reason in its notes");
  return options.back ? moveStableBack(version, ports, options.preview) : pinStable(version, ports, options.preview, options.expedited);
}
