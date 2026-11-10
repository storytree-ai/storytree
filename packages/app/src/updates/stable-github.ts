/** Capability 4 · Updates. Contract 4.16: GitHub holds the channel's metadata history; each installer stays on its original release. */
import { execFileSync } from "node:child_process";
import { CATALOGUE } from "@storytree/forest/actions";
import type { Library } from "@storytree/library";
import { STABLE_BRANCH } from "./release-channel.js";
import { type Git, versionAt } from "./release-source.js";
import { stableCandidate, type LagVerdict, type PublishedBuild, type StableCandidate } from "./stable-candidate.js";
import {
  FEED_PLATFORMS, mergedPullRequests, moveStableBack, pinCoverage, pinStable, readStableManifest, stableAge, windowsInstallers,
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
    { path: "README.md", mode: "100644", type: "blob", content: `${manifest.releaseNotes}\n\n${pinCoverage(manifest)}\n\n${stableAge(manifest) && `${stableAge(manifest)}\n\n`}Pinned from ${manifest.pin.commit}. Installer bytes remain on their original alpha releases.\n` },
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
  published_at: string | null;
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

/** The platforms a release has its own build of: Windows by its installers, the Mac and Linux by the builds their feeds name; a feed carried from an earlier build (4.6) counts for nothing. */
export function releasePlatforms(release: Pick<Release, "tag_name" | "assets">): PublishedBuild["platforms"] {
  const names = new Set(release.assets.map(a => a.name));
  const version = release.tag_name.slice(1);
  const built = (end: string) => [...names].some(n => n.startsWith(`storytree-0.3-${version}-`) && n.endsWith(end));
  return [
    ...([false, true].some(combined => windowsInstallers(version, combined).every(n => names.has(n))) ? ["windows" as const] : []),
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

/**
 * What says `version` passed its fresh-install sweep (4.25): the stable routine (fortnight.sh) raises "Pin 0.3.N as
 * stable?" only after the old-laptop acceptance run passed that build, so that question, unless retired as wrongly asked,
 * is the pass.
 */
export function sweptBy(questions: readonly { id: string; fields: Record<string, unknown> }[], version: string): string | undefined {
  const pass = questions.find(q => q.fields["title"] === `Pin ${version} as stable?` && q.fields["lifecycle"] !== "retired");
  return pass && `${pass.id}: the stable routine's fresh-install sweep on the old laptop passed ${version}`;
}

/**
 * Whether main's latest green nightly macOS run (macos-nightly.yml, ADR-1303 D3) tested `commit`: its head is that commit
 * or a later main commit containing it. Only the newest green run on main counts; a run off another branch tests nothing.
 */
export async function nightlyMacos(runs: readonly { id: number; head_sha: string; head_branch: string | null; conclusion: string | null }[], commit: string,
  contains: (head: string, commit: string) => Promise<boolean>): Promise<{ tested: boolean; evidence: string }> {
  const last = runs.find(r => r.head_branch === "main" && r.conclusion === "success");
  if (!last) return { tested: false, evidence: "main has no green nightly macOS run" };
  const at = last.head_sha.slice(0, 12), url = `https://github.com/${REPOSITORY}/actions/runs/${last.id}`;
  return await contains(last.head_sha, commit)
    ? { tested: true, evidence: `macOS nightly run ${last.id} tested main at ${at}, which contains this build (${url})` }
    : { tested: false, evidence: `main's last green nightly macOS run, ${last.id}, tested ${at} (${url})` };
}

/**
 * Whether main's commit `head` is `commit` or comes after it. Main is fetched first, so a nightly run's head newer than the
 * clone is known; a fetch that fails throws its own error rather than reading as "not after it".
 */
export function mainContains(git: Git): (head: string, commit: string) => Promise<boolean> {
  return async (head, commit) => {
    git("fetch", "origin", "+refs/heads/main:refs/remotes/origin/main");
    try { git("merge-base", "--is-ancestor", commit, head); return true; }
    catch { return false; }
  };
}

/**
 * The commit tagged `v<wanted>`, once it is on main and its first-parent count gives that version. A shallow clone (a cloud
 * session's checkout) counts only its own depth, so its history is fetched whole before it is counted.
 */
export function releaseCommit(git: Git, wanted: string): string {
  const shallow = git("rev-parse", "--is-shallow-repository") === "true";
  git("fetch", ...(shallow ? ["--unshallow"] : []), "origin", "+refs/heads/main:refs/remotes/origin/main", `refs/tags/v${wanted}:refs/tags/v${wanted}`);
  const commit = git("rev-parse", `v${wanted}^{commit}`);
  git("merge-base", "--is-ancestor", commit, "origin/main");
  if (versionAt(git, commit) !== wanted) throw new Error("Release tag and merged build version do not match");
  return commit;
}

/** A workspace package's folder and its package.json. */
export interface Manifest { folder: string; json: { name?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; devDependencies?: Record<string, string> } }

/**
 * Whether a changed path is the desktop app's code: in apps/desktop, in a workspace package it reaches (its own dependencies, dev ones
 * included because its build bundles them, then theirs), or the lockfile and root manifests that choose what is installed. Tests,
 * notes and the dev loop's own packages are not the app's code; a later build that changed only those measures the same app.
 */
export function appCode(manifests: readonly Manifest[]): (path: string) => boolean {
  const byName = new Map(manifests.map(m => [m.json.name, m]));
  const reached = new Set<Manifest>();
  const visit = (m: Manifest, dev: boolean) => {
    if (reached.has(m)) return;
    reached.add(m);
    for (const name of Object.keys({ ...m.json.dependencies, ...m.json.optionalDependencies, ...(dev ? m.json.devDependencies : {}) })) {
      const dependency = byName.get(name);
      if (dependency) visit(dependency, false);
    }
  };
  const desktop = manifests.find(m => m.folder === "apps/desktop");
  if (desktop) visit(desktop, true);
  const roots = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
  return path => roots.has(path) || [...reached].some(m => path.startsWith(`${m.folder}/`));
}

/** The lag run's verdicts on the catalogue's budget contracts (ADR-1001 D5), from their verified history: each names the commit it measured. */
export function lagVerdicts(contract: string, history: readonly { column: string; state: LagVerdict["state"]; note?: string }[]): LagVerdict[] {
  return history.flatMap(({ column, state, note }) => {
    const commit = column === "verified" ? /\bat commit ([0-9a-f]{40})\b/.exec(note ?? "")?.[1] : undefined;
    return commit ? [{ contract, state, note: note!, commit }] : [];
  });
}

/**
 * Whether main's commit `later` is `commit`, or comes after it with the same app code (appCode, read from `commit`'s manifests).
 * The lag run measures main's commits, so main's history is fetched whole once, a shallow clone's included, before any is compared.
 */
export function sameAppCode(git: Git): (commit: string, later: string) => Promise<boolean> {
  let fetched = false;
  const apps = new Map<string, (path: string) => boolean>();
  const appAt = (commit: string) => {
    if (!apps.has(commit)) {
      const folders = git("ls-tree", "-d", "--name-only", commit, "packages/", "apps/").split("\n").filter(Boolean);
      apps.set(commit, appCode(folders.flatMap(folder => {
        try { return [{ folder, json: JSON.parse(git("show", `${commit}:${folder}/package.json`)) as Manifest["json"] }]; }
        catch { return []; }
      })));
    }
    return apps.get(commit)!;
  };
  return async (commit, later) => {
    if (commit === later) return true;
    if (!fetched) {
      git("fetch", ...(git("rev-parse", "--is-shallow-repository") === "true" ? ["--unshallow"] : []), "origin", "+refs/heads/main:refs/remotes/origin/main");
      fetched = true;
    }
    try { git("merge-base", "--is-ancestor", commit, later); }
    catch { return false; }
    const app = appAt(commit);
    return !git("diff", "--name-only", commit, later).split("\n").filter(Boolean).some(app);
  };
}

/** `storytree release candidate`: the stable candidate read from GitHub and the library; it changes nothing. */
export async function findStableCandidate(options: { library: Pick<Library, "list" | "prCutover" | "healthHistory">; cwd: string }): Promise<StableCandidate> {
  const api = github(options.cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: options.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 }).trim();
  const commits = new Map<string, Promise<string>>();
  const commitOf = (version: string) => {
    if (!commits.has(version)) commits.set(version, (api(`commits/v${version}`) as Promise<{ sha: string }>).then(c => c.sha));
    return commits.get(version)!;
  };
  const sameApp = sameAppCode(git);
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
        const releases = await api(`releases?per_page=100&page=${page}`) as Release[];
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
      const sha = await commitOf(build.version);
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
    async lag() {
      const contracts = [...new Set(CATALOGUE.map(action => action.owner.contract))];
      const histories = await Promise.all(contracts.map(async contract => lagVerdicts(contract, await options.library.healthHistory(contract))));
      return { contracts, verdicts: histories.flat() };
    },
    commit: build => commitOf(build.version),
    sameApp,
    notes: async version => (await pinRelease(version, { ...options, preview: true })).releaseNotes,
    now: () => new Date().toISOString(),
  });
}

/** Thin front doors call this with their project library; all release rules stay in the app story. */
export async function pinRelease(version: string, options: { library: Pick<Library, "list" | "prCutover">; cwd: string; preview?: boolean; back?: boolean; expedited?: string }): Promise<StableManifest> {
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
      if (release.tag_name !== `v${wanted}` || release.draft || release.prerelease) throw new Error("Pin a published alpha build by its 0.3.<n> version");
      const remote = git("remote", "get-url", "origin");
      if (!/^(?:https:\/\/github\.com\/|git@github\.com:)storytree-ai\/storytree(?:\.git)?$/.test(remote)) throw new Error("Pin from a storytree checkout whose origin is storytree-ai/storytree");
      const commit = releaseCommit(git, wanted);
      type Entry = { name: string; sha256: string; sha512: string; size: number };
      const delivery = JSON.parse(download(release, "storytree-delivery.json")) as {
        schema: number; version: string; channelSchema: number; architectures: string[]; installers?: Record<string, Entry>; installer?: Entry;
      };
      if (delivery.schema !== 1 || delivery.version !== wanted || !delivery.architectures?.includes("x64") || !delivery.architectures.includes("arm64")) throw new Error("Release delivery manifest does not match the selected build");
      // One installer per architecture, or the one for both of a build from before the split.
      const entries = delivery.installers ? [delivery.installers["x64"], delivery.installers["arm64"]] : [delivery.installer];
      const installers = windowsInstallers(wanted, !delivery.installers).map((name, i) => {
        const entry = entries[i];
        const installer = asset(release, name);
        if (entry?.name !== installer.name || entry.size !== installer.size) throw new Error("Release installer does not match its delivery manifest");
        return { ...entry, url: installer.browser_download_url };
      });
      // The alpha updater's complete publication is required too; it remains untouched.
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
        ...(release.published_at ? { published: release.published_at } : {}), installers, feeds, bootstrap: {
          ps1: download(release, "install-storytree.ps1"),
          ...(release.assets.some(a => a.name === "install-storytree.sh") ? { sh: download(release, "install-storytree.sh") } : {}),
        } };
    },
    async pullRequests(commit) {
      return mergedPullRequests(git("log", "--first-parent", "--merges", "--format=%s", commit));
    },
    increments: () => options.library.list("increment"),
    cutover: () => options.library.prCutover(),
    swept: async version => sweptBy(await options.library.list("question"), version),
    async macos(commit) {
      const { workflow_runs } = await api("actions/workflows/macos-nightly.yml/runs?branch=main&status=completed&per_page=50") as {
        workflow_runs: { id: number; head_sha: string; head_branch: string | null; conclusion: string | null }[] };
      return nightlyMacos(workflow_runs, commit, mainContains(git));
    },
    publish: (manifest, bootstrap, expected) => publishStable(manifest, bootstrap, expected, api),
    now: () => new Date().toISOString(),
  };
  if (options.back && options.expedited) throw new Error("--expedited pins an urgent fix forward; --back moves stable back, and needs no reason in its notes");
  return options.back ? moveStableBack(version, ports, options.preview) : pinStable(version, ports, options.preview, options.expedited);
}
