/** Capability 4 · Updates. Contract 4.16: a stable pin is release metadata, never a second build. */
import { beforeCutover, type PrCutover } from "@storytree/library";

/** The repository the release notes' pull requests are on, until a repository cut-over names its own. */
const REPOSITORY = "storytree-ai/storytree";
export interface LandedIncrement {
  id: string;
  fields: { title: string; status: string; outcome?: { date?: string; disposition: string; pr?: string | undefined; note?: string | undefined } | undefined };
}
/** The platforms whose updaters read their own feed file beside latest.yml, and the build each must name. */
export const FEED_PLATFORMS = {
  mac: { name: "Mac", file: "latest-mac.yml", build: ".zip" },
  linux: { name: "Linux", file: "latest-linux.yml", build: ".AppImage" },
} as const;
export type FeedPlatform = keyof typeof FEED_PLATFORMS;
/** One platform's update feed as electron-updater reads it; every file stays on its original release. */
export interface PlatformFeed { version: string; files: { url: string; sha512: string; size: number; blockMapSize?: number }[] }
export type PlatformFeeds = Partial<Record<FeedPlatform, PlatformFeed>>;
export interface StableManifest {
  schema: 1;
  channel: "stable";
  version: string;
  files: { url: string; sha512: string; size: number }[];
  releaseNotes: string;
  /** Mac and Linux feeds; a platform this pin's release lacks keeps the build an earlier pin gave it. */
  feeds?: PlatformFeeds;
  pin: {
    commit: string;
    at: string;
    previous?: string;
    /** Set when this pin moved stable back to a build pinned before, to stop the named bad build spreading. */
    movedBackFrom?: string;
    /** The owner's reason for pinning this build without the 24-hour soak, as an urgent fix. */
    expedited?: string;
    /** What says this build passed its fresh-install sweep before the pin (4.25); absent on an expedited pin. */
    swept?: string;
    /** The platforms this pin moved to its version. */
    covers?: ("windows" | FeedPlatform)[];
    increments: { id: string; title: string; pr: string; note?: string }[];
    /** Includes earlier pins, so closures recorded late are included next time, never silently lost. */
    includedIncrements: string[];
  };
}
export interface PinCandidate {
  version: string;
  commit: string;
  channelSchema: number;
  draft: boolean;
  prerelease: boolean;
  /** Windows' installers: one per architecture (windowsInstallers), or the one for both of a build from before the split. */
  installers: { url: string; sha256: string; sha512: string; size: number }[];
  /** The release's one-line installers: Windows' always, the Mac's once releases publish it. */
  bootstrap: Bootstraps;
  /** Each platform feed the release itself published. */
  feeds: PlatformFeeds;
}
export interface Bootstraps { ps1: string; sh?: string }
export interface PinPorts {
  previous(): Promise<{ ref: string; manifest: StableManifest } | undefined>;
  /** The manifest the latest earlier pin of this version published, read from the stable branch's history. */
  formerPin(version: string): Promise<StableManifest | undefined>;
  /** The adapter checks the release tag is on main and its version matches that commit. */
  candidate(version: string): Promise<PinCandidate>;
  pullRequests(commit: string): Promise<ReadonlySet<string>>;
  increments(): Promise<readonly LandedIncrement[]>;
  /** The library's repository cut-over, when it has one: a pull request closed before it is the old repository's. */
  cutover?(): Promise<PrCutover | undefined>;
  /** What says this build passed its fresh-install sweep (4.25), or undefined while none has. */
  swept(version: string): Promise<string | undefined>;
  /** Publish atomically only while the channel still has the expected ref. */
  publish(manifest: StableManifest, bootstrap: Bootstraps, expectedRef?: string): Promise<void>;
  now(): string;
}

function buildNumber(version: string): number {
  if (!/^0\.3\.[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version.slice(4)))) throw new Error("Name an existing 0.3.<n> release");
  return Number(version.slice(4));
}

/** Subjects of first-parent merges: a reference to another PR in prose is not evidence it shipped. */
export function mergedPullRequests(subjects: string): ReadonlySet<string> {
  return new Set(subjects.split(/\r?\n/).flatMap(subject => /^Merge pull request #([1-9]\d*) from \S+$/.exec(subject)?.[1] ?? []));
}

export function readStableManifest(value: unknown): StableManifest {
  const manifest = value as StableManifest | null;
  if (!manifest || manifest.schema !== 1 || manifest.channel !== "stable" || typeof manifest.version !== "string" ||
      !manifest.pin || !/^[a-f0-9]{40}$/.test(manifest.pin.commit) || !Array.isArray(manifest.pin.includedIncrements) ||
      !manifest.pin.includedIncrements.every(id => typeof id === "string") || !Array.isArray(manifest.pin.increments) ||
      !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 2 || typeof manifest.releaseNotes !== "string" ||
      (manifest.feeds !== undefined && (typeof manifest.feeds !== "object" || manifest.feeds === null))) throw new Error("The stable pin is unreadable; refusing to replace it");
  buildNumber(manifest.version);
  for (const [p, feed] of Object.entries(manifest.feeds ?? {})) {
    if (!(p in FEED_PLATFORMS)) throw new Error("The stable pin is unreadable; refusing to replace it");
    checkFeed(p as FeedPlatform, feed, feed.version);
  }
  return manifest;
}

const RELEASES = "https://github.com/storytree-ai/storytree/releases/download";

/**
 * The Windows installer names a release of `version` publishes: one per architecture, which an installed app's updater
 * tells apart by its architecture in the name, or, for a build from before they were split, one carrying both.
 */
export function windowsInstallers(version: string, combined = false): string[] {
  return combined ? [`storytree-0.3-${version}-setup.exe`] : ["x64", "arm64"].map(arch => `storytree-0.3-${version}-windows-${arch}-setup.exe`);
}

function checkFeed(platform: FeedPlatform, feed: PlatformFeed, version: string): void {
  const { name, build } = FEED_PLATFORMS[platform];
  const own = `${RELEASES}/v${version}/`;
  const whole = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  if (feed.version !== version || !Array.isArray(feed.files) || !feed.files.some(f => f.url?.endsWith(build)) ||
      !feed.files.every(f => typeof f.url === "string" && f.url.startsWith(own) && !f.url.slice(own.length).includes("/") &&
        /^[A-Za-z0-9+/]{86}==$/.test(f.sha512) && whole(f.size) && (f.blockMapSize === undefined || whole(f.blockMapSize)))) {
    throw new Error(`The release's ${name} feed is not its own complete ${build} build; pin a complete release`);
  }
}

/** What a pin moved and what it left, for its output and the stable branch's README. */
export function pinCoverage(manifest: StableManifest): string {
  const covers = manifest.pin.covers ?? ["windows"];
  const moved = covers.map(p => p === "windows" ? "Windows" : FEED_PLATFORMS[p].name);
  const list = moved.length > 1 ? `${moved.slice(0, -1).join(", ")} and ${moved.at(-1)}` : moved[0];
  return [`${list} take${moved.length > 1 ? "" : "s"} ${manifest.version}.`, ...(Object.keys(FEED_PLATFORMS) as FeedPlatform[]).flatMap(p => {
    if (covers.includes(p)) return [];
    const kept = manifest.feeds?.[p]?.version;
    const name = FEED_PLATFORMS[p].name;
    return [kept ? `${name} stays on ${kept}: this release has no ${name} build.` : `${name} has no stable build yet: this release has no ${name} build.`];
  })].join(" ");
}

/**
 * Stops a bad pin spreading: stable goes back to a build it was pinned to before, with that pin's installer, feeds and
 * recorded increments, so the next pin lists again what only the bad build carried. Installs that already took the bad
 * build keep it (the updater never downgrades: their database may have been migrated forward).
 */
export async function moveStableBack(version: string, ports: PinPorts, preview = false): Promise<StableManifest> {
  const build = buildNumber(version);
  const current = await ports.previous();
  if (!current) throw new Error("Nothing is pinned as stable, so there is nothing to move back");
  readStableManifest(current.manifest);
  const from = current.manifest.version;
  if (build >= buildNumber(from)) throw new Error(`--back moves stable to an older build than ${from}; pin a newer build without --back`);
  const former = await ports.formerPin(version);
  if (!former) throw new Error(`Stable was never pinned to ${version}; --back moves only to a build pinned before`);
  readStableManifest(former);
  const candidate = await ports.candidate(version);
  if (candidate.version !== version || candidate.commit !== former.pin.commit) throw new Error("The formerly pinned release identity changed");
  const manifest: StableManifest = {
    ...former,
    releaseNotes: `${former.releaseNotes}\n\nStable moved back from ${from} to ${version} to stop ${from} spreading; installs that already took ${from} keep it.`,
    pin: { ...former.pin, at: ports.now(), previous: from, movedBackFrom: from },
  };
  if (!preview) await ports.publish(manifest, candidate.bootstrap, current.ref);
  return manifest;
}

/**
 * `expedited` is the owner's reason for pinning an urgent fix without the 24-hour soak; the notes say it first. Any
 * other pin waits on the build's fresh-install sweep (4.25, the owner's answer on question_0e1c032af8b9): a preview
 * only reads, and an expedited fix waives the sweep as it waives the soak (ADR-1032 D7).
 */
export async function pinStable(version: string, ports: PinPorts, preview = false, expedited?: string): Promise<StableManifest> {
  const build = buildNumber(version);
  const previous = await ports.previous();
  if (previous) {
    readStableManifest(previous.manifest);
    if (build < buildNumber(previous.manifest.version)) {
      throw new Error("An older release cannot replace the stable pin; to stop a bad pin spreading, move it back with --back to a build pinned before");
    }
  }
  const candidate = await ports.candidate(version);
  const installers = candidate.installers;
  const urls = installers.map(i => i.url).join(" ");
  const own = [false, true].some(combined => windowsInstallers(version, combined).map(name => `${RELEASES}/v${version}/${name}`).join(" ") === urls);
  if (candidate.version !== version || candidate.draft || candidate.prerelease || candidate.channelSchema !== 1 ||
      !/^[a-f0-9]{40}$/.test(candidate.commit) || !candidate.bootstrap.ps1 || !own || !installers.every(installer =>
        /^[a-f0-9]{64}$/i.test(installer.sha256) && /^[A-Za-z0-9+/]{86}==$/.test(installer.sha512) && Number.isSafeInteger(installer.size) && installer.size >= 1)) {
    throw new Error("The release is incomplete or does not support stable installation channels; pin a complete channel-aware release");
  }
  const platforms = (Object.keys(FEED_PLATFORMS) as FeedPlatform[]).filter(p => candidate.feeds[p] !== undefined);
  for (const p of platforms) checkFeed(p, candidate.feeds[p]!, version);
  if (previous?.manifest.version === version) {
    if (previous.manifest.pin.commit !== candidate.commit) throw new Error("The pinned release identity changed");
    return previous.manifest;
  }
  const swept = expedited ? undefined : await ports.swept(version);
  if (!preview && !expedited && !swept) {
    throw new Error(`storytree ${version} has not passed its fresh-install sweep, so it cannot be pinned yet. On the Mint box, packages/app-setup/testing/stable-acceptance/harness/fortnight.sh --now runs it on the stable candidate; an urgent fix is pinned with --expedited instead`);
  }
  const reachable = await ports.pullRequests(candidate.commit);
  const included = new Set(previous?.manifest.pin.includedIncrements ?? []);
  const cutover = await ports.cutover?.();
  const increments = (await ports.increments()).flatMap(({ id, fields }) => {
    const outcome = fields.outcome;
    if (included.has(id) || fields.status !== "closed" || outcome?.disposition !== "landed" || !outcome.pr) return [];
    // Closed before the repository cut-over, its number is the old repository's, never one this build's history merged.
    if (outcome.date !== undefined && beforeCutover(cutover, outcome.date)) return [];
    const pr = /^(?:https:\/\/github\.com\/storytree-ai\/storytree\/pull\/|#)?([1-9]\d*)$/.exec(outcome.pr)?.[1];
    if (!pr || !reachable.has(pr)) return [];
    included.add(id);
    return [{ id, title: fields.title, pr, ...(outcome.note ? { note: outcome.note } : {}) }];
  });
  const releaseNotes = [`# storytree ${version}`, "", ...(expedited ? [`Expedited without the 24-hour soak: ${expedited}`, ""] : []), ...increments.flatMap(i => [
    `- ${i.title} ([#${i.pr}](https://github.com/${cutover?.repository ?? REPOSITORY}/pull/${i.pr}))${i.note ? ` — ${i.note}` : ""}`,
  ]), ...(increments.length ? [] : ["No newly recorded landed increments in this build."])].join("\n");
  const feeds: PlatformFeeds = {};
  for (const p of Object.keys(FEED_PLATFORMS) as FeedPlatform[]) {
    const feed = candidate.feeds[p] ?? previous?.manifest.feeds?.[p];
    if (feed) feeds[p] = feed;
  }
  const manifest: StableManifest = {
    schema: 1, channel: "stable", version,
    files: installers.map(({ url, sha512, size }) => ({ url, sha512, size })), releaseNotes, feeds,
    pin: { commit: candidate.commit, at: ports.now(), ...(previous ? { previous: previous.manifest.version } : {}), ...(expedited ? { expedited } : {}), ...(swept ? { swept } : {}),
      covers: ["windows", ...platforms],
      increments, includedIncrements: [...included] },
  };
  if (!preview) await ports.publish(manifest, candidate.bootstrap, previous?.ref);
  return manifest;
}
